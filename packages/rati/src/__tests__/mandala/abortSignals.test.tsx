import { describe, test, expect, afterEach } from 'vite-plus/test';
import { act, type FC } from 'react';
import { scope, input, data, type LoadContext } from '../../scope/scope';
import { island } from '../../island/island';
import {
    cleanup,
    controllableSource,
    deferred,
    flush,
    prerenderToString,
    renderIsland,
} from '../../testing';

/*
    SI-01 — the abort signal a function load receives as its second argument.

    The contract in one line: the signal belongs to the *run*, not to the load. It fires when
    the run that started the load is discarded (an inputs change, a retry, `refresh()`,
    unmount) and at no other time — a plain re-render, a selective `refresh(key)`, and a
    mid-tree teardown that keeps the bucket cache must all leave it alone. One
    AbortController per bucket, fired by `discardRun` (mandala/refresh.ts).
*/

const Loading: FC = () => <div>loading...</div>;

afterEach(cleanup);

// A load that records the context of every run it is asked to perform. `aborts` collects run
// indices as their signals fire, so "exactly once, for the discarded run only" reads as a
// list rather than a boolean.
function trackedLoad<T>(produce: (run: number) => Promise<T>) {
    const signals: AbortSignal[] = [];
    const aborts: number[] = [];
    const listening = new WeakSet<AbortSignal>();
    const load = (_props: unknown, { signal }: LoadContext): Promise<T> => {
        const run = signals.length;
        signals.push(signal);
        // One listener per signal, not per call: a selective refresh re-runs the load with
        // the same signal, and two listeners on one controller would read as two aborts.
        if (!listening.has(signal)) {
            listening.add(signal);
            signal.addEventListener('abort', () => aborts.push(run));
        }
        return produce(run);
    };
    return { signals, aborts, load };
}

describe("a load's abort signal", () => {
    test('stays live while its run is the current one', async () => {
        const tracked = trackedLoad(async (run) => `v${run}`);
        const handle = await renderIsland(
            {
                scope: scope({ id: input<string>() }).load({ value: tracked.load }),
                component: ({ value }) => <span>{value}</span>,
                loading: Loading,
            },
            { props: { id: 'a' } },
        );

        expect(handle.slot()).toBe('content');
        expect(handle.text()).toBe('v0');
        expect(tracked.signals[0]!.aborted).toBe(false);

        // Re-rendering with the same inputs is not a new run — nothing is discarded, so
        // nothing may be cancelled (and the load isn't re-run: its cell is cached).
        await handle.rerender({ id: 'a' });
        expect(tracked.signals).toHaveLength(1);
        expect(tracked.aborts).toEqual([]);
    });

    test('fires on an inputs change — for the run it replaced, not the new one', async () => {
        const tracked = trackedLoad(async (run) => `v${run}`);
        const handle = await renderIsland(
            {
                scope: scope({ id: input<string>() }).load({ value: tracked.load }),
                component: ({ value }) => <span>{value}</span>,
                loading: Loading,
            },
            { props: { id: 'a' } },
        );

        await handle.rerender({ id: 'b' });
        expect(tracked.signals).toHaveLength(2);
        expect(tracked.aborts).toEqual([0]);
        expect(tracked.signals[1]!.aborted).toBe(false);
        expect(handle.text()).toBe('v1');
    });

    test('fires on unmount, for every level of the run', async () => {
        // Two levels — two buckets, so two controllers: the whole run goes, not just the
        // level that happened to be rendering.
        const first = trackedLoad(async () => 'one');
        const second = trackedLoad(async () => 'two');
        const handle = await renderIsland({
            scope: scope().load({ a: first.load }).load({ b: second.load }),
            component: ({ a, b }) => (
                <span>
                    {a} {b}
                </span>
            ),
            loading: Loading,
        });

        expect(handle.slot()).toBe('content');
        expect(first.signals[0]!.aborted).toBe(false);
        expect(second.signals[0]!.aborted).toBe(false);

        handle.unmount();
        expect(first.aborts).toEqual([0]);
        expect(second.aborts).toEqual([0]);
    });

    test('fires on an error-slot retry — a failed run is discarded like any other', async () => {
        // `gate` rejects first, so the run reaches the error slot with the tracked load's own
        // promise still in flight (built, never `use()`d — the level suspended past it).
        const tracked = trackedLoad(() => deferred<string>().promise);
        let attempt = 0;
        const handle = await renderIsland({
            scope: scope().load({
                gate: () => {
                    attempt += 1;
                    return attempt === 1
                        ? Promise.reject(new Error('nope'))
                        : Promise.resolve('ok');
                },
                value: tracked.load,
            }),
            component: ({ value }) => <span>{value}</span>,
            loading: Loading,
            error: ({ retry }) => <button onClick={retry}>retry</button>,
        });

        expect(handle.slot()).toBe('error');
        expect(tracked.aborts).toEqual([]);

        await act(async () => {
            handle.container.querySelector('button')!.click();
        });

        expect(tracked.signals).toHaveLength(2);
        expect(tracked.aborts).toEqual([0]);
        expect(tracked.signals[1]!.aborted).toBe(false);
    });

    test('fires on refresh() — the whole-scope re-resolve — but not on refresh(key)', async () => {
        const tracked = trackedLoad(async (run) => `v${run}`);
        const handle = await renderIsland({
            scope: scope().load({ value: tracked.load }),
            component: ({ value }) => <span>{value}</span>,
            loading: Loading,
        });

        // Selective: the load re-runs *inside* the run, so its cell is replaced but the run —
        // and its signal — is not. The re-run is handed the very same signal.
        let settled: Promise<void>;
        await act(async () => {
            settled = handle.controls().refresh('value');
        });
        await settled!;
        expect(tracked.signals).toHaveLength(2);
        expect(tracked.signals[1]).toBe(tracked.signals[0]);
        expect(tracked.aborts).toEqual([]);
        expect(handle.text()).toBe('v1');

        // Whole-scope: a fresh inner tree, so the run it replaces goes.
        await act(async () => {
            void handle.controls().refresh();
        });
        await flush();
        expect(tracked.signals).toHaveLength(3);
        expect(tracked.aborts).toEqual([0]);
        expect(tracked.signals[2]!.aborted).toBe(false);
        expect(handle.text()).toBe('v2');
    });

    test('survives a mid-tree teardown that keeps the run', async () => {
        // S8: a source dropping back to pending unmounts the levels below it for real, but
        // their buckets stay live (they are reused when it recovers) — cancelling their loads
        // there would kill data the island still intends to show.
        const top = controllableSource<string>();
        const tracked = trackedLoad(async (run) => `v${run}`);
        const handle = await renderIsland({
            scope: scope()
                .load({ head: () => top })
                .load({ value: tracked.load }),
            component: ({ value }) => <span>{value}</span>,
            loading: Loading,
        });

        await act(async () => {
            top.setReady('up');
        });
        expect(handle.slot()).toBe('content');
        expect(tracked.signals).toHaveLength(1);

        await act(async () => {
            top.setPending();
        });
        expect(handle.slot()).toBe('loading');
        expect(tracked.aborts).toEqual([]);

        // Back to ready: the cached cell renders, the load never re-ran.
        await act(async () => {
            top.setReady('up again');
        });
        expect(handle.slot()).toBe('content');
        expect(tracked.signals).toHaveLength(1);
        expect(tracked.aborts).toEqual([]);
    });

    test('reaches a data() load too, and a load that ignores it is unaffected', async () => {
        const seen: LoadContext[] = [];
        const handle = await renderIsland(
            {
                scope: scope({ id: input<string>() })
                    // No second parameter: the pre-SI-01 shape, still exactly as it was.
                    .load({ plain: async ({ id }) => `plain:${id}` })
                    .load({
                        gated: data((_props: unknown, context: LoadContext) => {
                            seen.push(context);
                            return Promise.resolve('gated');
                        }),
                    }),
                component: ({ plain, gated }) => (
                    <span>
                        {plain} {gated}
                    </span>
                ),
                loading: Loading,
            },
            { props: { id: 'a' } },
        );

        expect(handle.text()).toBe('plain:a gated');
        expect(seen[0]!.signal).toBeInstanceOf(AbortSignal);
        expect(seen[0]!.signal.aborted).toBe(false);

        handle.unmount();
        expect(seen[0]!.signal.aborted).toBe(true);
    });

    test('its late rejection is swallowed — no unhandled rejection, no stale write', async () => {
        // The load React never got to `use()`: `slow` suspends the level first, so
        // `cancellable`'s promise sits in the bucket with no reader attached to it at all.
        // Abort it and its rejection is nobody's — unless the discard swallows it first.
        const unhandled: unknown[] = [];
        const onUnhandled = (reason: unknown) => unhandled.push(reason);
        process.on('unhandledRejection', onUnhandled);
        try {
            const slow = deferred<string>();
            // Fetch-shaped: it rejects when its signal fires. Only the run being discarded
            // hangs — the one that replaces it resolves, so the island reaches content.
            const cancellable = ({ id }: { id: string }, { signal }: LoadContext) =>
                id === 'a'
                    ? new Promise<string>((_resolve, reject) => {
                          signal.addEventListener('abort', () => {
                              reject(signal.reason as Error);
                          });
                      })
                    : Promise.resolve(`done:${id}`);
            const handle = await renderIsland(
                {
                    scope: scope({ id: input<string>() }).load({
                        slow: ({ id }) =>
                            id === 'a' ? slow.promise : Promise.resolve(`fast:${id}`),
                        cancellable,
                    }),
                    component: ({ slow: value }) => <span>{value}</span>,
                    loading: Loading,
                    error: ({ error }) => <span>error {error.code}</span>,
                },
                { props: { id: 'a' } },
            );
            expect(handle.slot()).toBe('loading');

            // The inputs change discards that run mid-flight. The new one resolves, and the
            // old one's abort rejection must not write anything into the island it left.
            await handle.rerender({ id: 'b' });
            expect(handle.slot()).toBe('content');
            expect(handle.text()).toBe('fast:b');

            // Node reports an unhandled rejection a macrotask after the microtasks drain.
            await new Promise((resolve) => setTimeout(resolve, 0));
            expect(unhandled).toEqual([]);
            expect(handle.slot()).toBe('content');
        } finally {
            process.off('unhandledRejection', onUnhandled);
        }
    });

    test('never fires during a server render', async () => {
        // Under `prerender` there is no remount and no unmount: the controller is created
        // with the level's cells and simply never fires. (Cancelling on a client disconnect
        // would be a seam of its own — see the SI-01 record.)
        const tracked = trackedLoad(async () => 'server');
        const Island = island({
            scope: scope().load({ value: tracked.load }),
            component: ({ value }: { value: string }) => <span>{value}</span>,
            loading: Loading,
        });

        const html = await prerenderToString(<Island />);
        expect(html).toContain('server');
        expect(tracked.signals).toHaveLength(1);
        expect(tracked.signals[0]!.aborted).toBe(false);
    });
});
