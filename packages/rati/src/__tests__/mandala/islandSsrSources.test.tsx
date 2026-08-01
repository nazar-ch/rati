import { describe, test, expect, afterEach, vi } from 'vite-plus/test';
import { act } from 'react';
import { scope, input } from '../../scope/scope';
import type { SourceError } from '../../scope/source';
import { island } from '../../island/island';
import { controllableSource, prerenderToString, ssrRender, cleanup } from '../../testing';

afterEach(cleanup);

// The SSR-source shapes, built on the entry's `controllableSource`. The attach/detach (and
// hydrate) *string log* they push into is what the pins below assert against — an ordering
// between lifecycle events that the source's own numeric ledger deliberately doesn't model —
// so it is wired through the `onAttach`/`onDetach` hooks (and the seed's `hydrate`), not
// hand-rolled onto a bespoke source.

// The loader shape (`ssr: true`): a promise in source clothing that settles with `value` on
// attach.
function loaderSource<T>(value: T, log: string[]) {
    return controllableSource<T>({
        ssr: true,
        loads: value,
        onAttach: () => log.push('attach'),
        onDetach: () => log.push('detach'),
    });
}

// A live, seedable source over a tiny mutable store — the query-backed shape
// (`ssr: { dehydrate, hydrate }`). `hydrate` seeds the source so the first snapshot is
// already ready; `loads` drives the on-attach resolve when unseeded, and `setReady` the live
// transitions after hydration.
function liveSource(
    log: string[],
    // Replaces the default seeding — the drifted-store case (a `hydrate` that throws).
    hydrate?: (data: unknown) => { n: number },
) {
    return controllableSource<{ n: number }>({
        loads: { n: 1 },
        seed: {
            dehydrate: (value) => value.n,
            hydrate:
                hydrate ??
                ((data) => {
                    log.push(`hydrate:${String(data)}`);
                    return { n: data as number };
                }),
        },
        onAttach: () => log.push('attach'),
        onDetach: () => log.push('detach'),
    });
}

describe('SSR sources — loader (ssr: true)', () => {
    test('resolves server-side through the promise path and dehydrates the value', async () => {
        const log: string[] = [];
        const Island = island({
            scope: scope({ id: input<string>() }).load({
                greeting: () => loaderSource('hello ssr-source', log),
            }),
            component: ({ greeting }) => <div>{greeting}</div>,
            loading: () => <div>loading slot</div>,
        });

        const server = await ssrRender(<Island id="ssr" />);

        expect(server.html).toContain('hello ssr-source');
        expect(server.html).not.toContain('loading slot');
        // Attached during render (the marker's authorization), detached once settled.
        expect(log).toEqual(['attach', 'detach']);
        // Dehydrated as a plain value — promise semantics on the wire.
        expect(Object.values(server.data)).toEqual([{ greeting: 'hello ssr-source' }]);
        expect(Object.keys(server.seeds)).toHaveLength(0);
    });

    test('hydrates as a plain value — the loader never runs client-side', async () => {
        const log: string[] = [];
        let created = 0;
        const Island = island({
            scope: scope({ id: input<string>() }).load({
                greeting: () => {
                    created++;
                    return loaderSource(`hello ${created}`, log);
                },
            }),
            component: ({ greeting }) => <div>{greeting}</div>,
            loading: () => <div>loading slot</div>,
        });

        const server = await ssrRender(<Island id="ssr" />);
        expect(created).toBe(1);

        const client = await server.hydrate();

        // Short-circuited to the dehydrated value: no second instance, no client attach.
        expect(created).toBe(1);
        expect(log).toEqual(['attach', 'detach']);
        expect(client.text()).toContain('hello 1');
        // …and the short-circuit was seamless: rendering the value the server rendered
        // means React had no mismatch to recover from. The pins below are the contrast —
        // there, a recovery is the degradation itself. (`.hydrate()` would throw on one.)
        expect(client.recovered).toEqual([]);
    });
});

describe('SSR sources — live (ssr: { dehydrate, hydrate })', () => {
    test('dehydrates a seed; the client seeds before attach and stays live', async () => {
        const serverLog: string[] = [];
        const clientLog: string[] = [];
        const logs = [serverLog, clientLog];
        const instances: ReturnType<typeof liveSource>[] = [];
        let created = 0;
        const Island = island({
            scope: scope({ id: input<string>() }).load({
                counter: () => {
                    const source = liveSource(logs[created++]!);
                    instances.push(source);
                    return source;
                },
            }),
            component: ({ counter }) => <div>{`n is ${counter.n}`}</div>,
            loading: () => <div>loading slot</div>,
        });

        const server = await ssrRender(<Island id="ssr" />);
        expect(server.html).toContain('n is 1');
        // Dehydrated through `dehydrate` into the seeds section, not as a value.
        expect(Object.values(server.seeds)).toEqual([{ counter: 1 }]);
        expect(Object.keys(server.data)).toHaveLength(0);

        const client = await server.hydrate();

        // The client created its own instance, seeded it before attaching (hydrate
        // precedes attach in the log), and rendered ready HTML with no loading flash.
        expect(created).toBe(2);
        expect(clientLog).toEqual(['hydrate:1', 'attach']);
        expect(client.text()).toContain('n is 1');
        // The seed's whole purpose, asserted where it shows: seeding *before* attach is
        // what makes the first client render match the server's. Pin 7b below is the
        // same source with a failing seed, and it mismatches (`.hydrate()` would throw).
        expect(client.recovered).toEqual([]);

        // Still fully live: a later transition updates the content.
        act(() => instances[1]!.setReady({ n: 5 }));
        expect(client.text()).toContain('n is 5');
    });
});

/*
    Pin 7 (MF-05; docs/archive/mandala-testing.md §"Deterministic pins"): what the two
    SSR-source failure modes do. Both pin the *degraded* behavior on purpose — an SSR
    source that fails must cost the server render, never the page.
*/

// The loader shape's error path: attach starts work that fails instead of resolving —
// driven from `onAttach` (the loader-that-fails pattern controllableSource documents).
function failingLoaderSource(log: string[], error: SourceError) {
    const source = controllableSource<string>({
        ssr: true,
        onAttach: () => {
            log.push('attach');
            queueMicrotask(() => source.setError(error));
        },
        onDetach: () => log.push('detach'),
    });
    return source;
}

describe('SSR sources — error paths', () => {
    // Pin 7a. A marked source erroring during `firstSettle` is a rejecting promise load
    // by any other name, so it lands in the behavior islandSsrErrors.test.tsx pinned by
    // experiment: `prerender` resolves, React emits the loading slot behind its
    // "switched to client rendering" marker, and the error slot never participates
    // server-side. What rati adds is the `collectError` record (the server's 404/5xx
    // signal) — reached here through a *source*, and the client then makes its own
    // attempt against a fresh instance.
    //
    // NB: the strategy doc's pin list and suspense-situations.md §S10 both predicted an
    // error slot in the HTML. That is not what React does — both are corrected in this
    // commit; this test is the pin.
    //
    // Kill: ssrSource.ts `firstSettle()` — `reject(state.error)` → `reject(new
    // Error('source failed'))`, the wrapper the comment there warns about → the code is
    // erased, 'not-available' arrives as 'failed', and the 404 signal is gone.
    test('a marked source erroring server-side degrades to the loading slot and records the error', async () => {
        const serverLog: string[] = [];
        const clientLog: string[] = [];
        let created = 0;
        const Island = island({
            scope: scope({ id: input<string>() }).load({
                feed: () => {
                    created++;
                    // The server's instance fails; the client's own attempt succeeds.
                    return created === 1
                        ? failingLoaderSource(serverLog, {
                              code: 'not-available',
                              message: 'no feed',
                          })
                        : loaderSource('feed live', clientLog);
                },
            }),
            component: ({ feed }) => <div>content: {feed}</div>,
            loading: () => <div>LOADING-SLOT</div>,
            error: ({ error }) => <div>ERROR-SLOT: {error.code}</div>,
        });

        const server = await ssrRender(<Island id="ssr" />, { onError: () => {} });

        expect(server.html).toContain('LOADING-SLOT');
        expect(server.html).not.toContain('ERROR-SLOT');
        // Attached during render and released once settled — the error settles it too.
        expect(serverLog).toEqual(['attach', 'detach']);
        // Nothing on the wire: no value to dehydrate, no seed.
        expect(server.data).toEqual({});
        expect(server.seeds).toEqual({});
        // The source's own code survives to the server's status decision — a marked
        // source is a 404 signal exactly like a rejecting promise load.
        expect(server.errors).toHaveLength(1);
        expect(server.errors[0]!.key).toBe('feed');
        expect(server.errors[0]!.error.code).toBe('not-available');

        // The server's boundary errored, so its HTML carries React's client-retry marker
        // and hydration reports the switch as a recoverable error. That report *is* the
        // degradation being visible; `allowMismatch` collects it on `.recovered` instead
        // of throwing, so it doesn't leak out of the run as an unhandled error.
        const client = await server.hydrate(undefined, { allowMismatch: true });

        // The failure did not travel: the client created and attached its own instance
        // and resolved it live.
        expect(created).toBe(2);
        expect(clientLog).toEqual(['attach']);
        expect(client.text()).toContain('feed live');
    });

    // Pin 7b. A seed the client cannot apply (a `hydrate()` that throws — a store shape
    // that drifted from the server's) is logged and dropped, and the source resolves
    // live from its own attach: degraded, not broken. The page's cost is the pending
    // window the seed was there to skip.
    //
    // Kill: resolver.tsx `buildCell()`, the seed branch — replace the catch body's
    // `console.error(...)` with `throw error` → a seed it cannot apply takes the
    // hydration render down instead of degrading to a live resolve.
    test('a seed whose hydrate() throws is logged, and the source resolves live anyway', async () => {
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const serverLog: string[] = [];
        const clientLog: string[] = [];
        let created = 0;
        const Island = island({
            scope: scope({ id: input<string>() }).load({
                counter: () => {
                    created++;
                    // The client's instance cannot take the server's seed.
                    return created === 1
                        ? liveSource(serverLog)
                        : liveSource(clientLog, () => {
                              throw new Error('seed shape drifted');
                          });
                },
            }),
            component: ({ counter }) => <div>{`n is ${counter.n}`}</div>,
            loading: () => <div>loading slot</div>,
        });

        const server = await ssrRender(<Island id="ssr" />);
        expect(Object.values(server.seeds)).toEqual([{ counter: 1 }]);

        // A seed that fails to apply *guarantees* a hydration mismatch: the server shipped
        // ready HTML over a source the client now renders pending. React recovers by
        // client-rendering the boundary — the second half of this degradation's cost, and
        // the reason a seedable source's `hydrate` must be total. `allowMismatch` observes
        // the recovery instead of throwing.
        const client = await server.hydrate(undefined, { allowMismatch: true });

        expect(
            errorSpy.mock.calls.some((args) =>
                String(args[0]).includes("hydration seed for 'counter' failed to apply"),
            ),
        ).toBe(true);
        // Unseeded, so it went through its own pending window and attached as usual —
        // the page still arrives at live content.
        expect(clientLog).toEqual(['attach']);
        expect(client.text()).toContain('n is 1');
        errorSpy.mockRestore();
    });
});

describe('SSR sources — gating', () => {
    test('without a hydration collector a marked source stays pending (no way to carry it)', async () => {
        const log: string[] = [];
        const Island = island({
            scope: scope({ id: input<string>() }).load({
                greeting: () => loaderSource('hello', log),
            }),
            component: ({ greeting }) => <div>{greeting}</div>,
            loading: () => <div>loading slot</div>,
        });

        const html = await prerenderToString(<Island id="ssr" />);

        // Server-resolving without dehydration would mismatch on the client — the
        // marker only engages under a HydrationProvider.
        expect(html).toContain('loading slot');
        expect(html).not.toContain('hello');
        expect(log).toHaveLength(0);
    });
});
