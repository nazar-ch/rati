import { describe, test, expect, afterEach, vi } from 'vite-plus/test';

import type { FC, ReactElement } from 'react';
import { hydrateRoot } from 'react-dom/client';

import { render, screen, cleanup, act } from '@testing-library/react';

import { probeControls, testSource } from './scopeControlsHarness.js';

import { island } from '../../island/island.js';
import { createHydrationCollector, HydrationProvider } from '../../mandala/hydration.js';
import { scope, data, input } from '../../scope/scope.js';
import {
    deferred,
    flush,
    prerenderToString,
    type ControllableSource,
} from '../../testing/index.js';

const Loading: FC = () => <div>loading...</div>;

afterEach(cleanup);

/*
    The deterministic pins for the refresh machinery, each with a KILL note: the one-line source
    mutation that must make it fail. They guard the contract docs/current/public/reference.md
    states for `useScopeControls`, never the mechanism.
*/

describe('selective refresh — races', () => {
    // Pin 1. The race guard: the newest re-run of a key wins, whenever the older one lands,
    // and `refresh(key)` resolves for both callers.
    //
    // Kill: refresh.ts `settled()` — drop `cell.refreshing?.token !== token` from the
    // guard → the superseded run applies and 'stale' renders over 'v3'.
    test('a superseded refresh: the older settle is discarded, the newer one wins', async () => {
        const runs: ReturnType<typeof deferred<string>>[] = [];
        const testScope = scope().load({
            greeting: () => {
                const run = deferred<string>();
                runs.push(run);
                return run.promise;
            },
        });
        const { captured, Probe } = probeControls(testScope);
        const Island = island({
            scope: testScope,
            component: ({ greeting }) => (
                <div>
                    <span>value {greeting}</span>
                    <Probe />
                </div>
            ),
            loading: Loading,
        });

        await act(async () => {
            render(<Island />);
        });
        await act(async () => {
            runs[0]!.resolve('v1');
        });
        expect(screen.getByText('value v1')).toBeTruthy();

        // Two re-runs in flight at once (runs[1], runs[2]) — the second supersedes.
        let first!: Promise<void>;
        let second!: Promise<void>;
        await act(async () => {
            first = captured.current!.refresh('greeting');
        });
        await act(async () => {
            second = captured.current!.refresh('greeting');
        });
        expect(runs).toHaveLength(3);
        expect([...captured.current!.pending]).toEqual(['greeting']);

        // The newer one settles first…
        await act(async () => {
            runs[2]!.resolve('v3');
            await second;
        });
        expect(screen.getByText('value v3')).toBeTruthy();

        // …and the superseded one lands late: inert, and the older caller's promise
        // settled with the key rather than hanging on a settle that never applies.
        await act(async () => {
            runs[1]!.resolve('stale');
            await first;
        });
        expect(screen.getByText('value v3')).toBeTruthy();
        expect(captured.current!.pending.size).toBe(0);
    });

    // Pin 2. A remount discards the cells a refresh was re-running: the bookkeeping settles
    // wholesale, and the late settle touches nothing.
    //
    // Kill: refresh.ts `treeCommitted()` — drop the `this.pendingKeys.clear()` branch →
    // the discarded refresh stays in `pending` for the fresh tree's lifetime.
    test('a remount during an in-flight refresh: waiters settle, pending clears, the late settle is inert', async () => {
        const runs: ({ id: string } & ReturnType<typeof deferred<string>>)[] = [];
        const testScope = scope({ id: input<string>() }).load({
            greeting: ({ id }) => {
                const run = deferred<string>();
                runs.push({ id, ...run });
                return run.promise;
            },
        });
        const { captured, Probe } = probeControls(testScope);
        const Island = island({
            scope: testScope,
            component: ({ greeting }) => (
                <div>
                    <span>value {greeting}</span>
                    <Probe />
                </div>
            ),
            loading: Loading,
        });

        let rerender!: (element: ReactElement) => void;
        await act(async () => {
            ({ rerender } = render(<Island id="a" />));
        });
        await act(async () => {
            runs[0]!.resolve('a1');
        });
        expect(screen.getByText('value a1')).toBeTruthy();

        let settled!: Promise<void>;
        await act(async () => {
            settled = captured.current!.refresh('greeting');
        });
        expect(runs).toHaveLength(2);
        expect([...captured.current!.pending]).toEqual(['greeting']);

        // The inputs change mid-flight: the inner tree remounts and loads from scratch.
        await act(async () => {
            rerender(<Island id="b" />);
        });
        expect(runs).toHaveLength(3);
        expect(runs[2]!.id).toBe('b');
        // The caller is released by the remount itself — it never waits on a settle that
        // can no longer apply anywhere.
        await act(async () => {
            await settled;
        });

        await act(async () => {
            runs[2]!.resolve('b1');
        });
        expect(screen.getByText('value b1')).toBeTruthy();
        // Read at a quiesce point, once the fresh tree is on screen: the probe renders
        // inside the island's content, so while the remount is suspended it is still the
        // OLD tree's last render, holding a snapshot from before the remount (S11).
        expect(captured.current!.pending.size).toBe(0);

        // The discarded generation's re-fetch lands last: it belongs to cells that no
        // longer exist, so it applies nothing to the fresh tree.
        await act(async () => {
            runs[1]!.resolve('stale');
        });
        await flush();
        expect(screen.getByText('value b1')).toBeTruthy();
        expect(captured.current!.pending.size).toBe(0);
    });

    // Pin 6. Two keys re-fetching at once are tracked independently — `pending` holds
    // both, and neither settle order loses an update.
    //
    // Kill: refresh.ts `settled()` — a global guard (`cell.refreshing?.token !==
    // this.tokens`) → the later refresh supersedes the earlier KEY; x stays 'x1'.
    test('concurrent refreshes of different keys: pending holds both; either settle order converges', async () => {
        const xRuns: ReturnType<typeof deferred<string>>[] = [];
        const yRuns: ReturnType<typeof deferred<string>>[] = [];
        const testScope = scope().load({
            x: () => {
                const run = deferred<string>();
                xRuns.push(run);
                return run.promise;
            },
            y: () => {
                const run = deferred<string>();
                yRuns.push(run);
                return run.promise;
            },
        });
        const { captured, Probe } = probeControls(testScope);
        const Island = island({
            scope: testScope,
            component: ({ x, y }: { x: string; y: string }) => (
                <div>
                    <span>
                        {x}/{y}
                    </span>
                    <Probe />
                </div>
            ),
            loading: Loading,
        });

        await act(async () => {
            render(<Island />);
        });
        await act(async () => {
            xRuns[0]!.resolve('x1');
            yRuns[0]!.resolve('y1');
        });
        expect(screen.getByText('x1/y1')).toBeTruthy();

        await act(async () => {
            // why-void: the case reads the effects, never the promise, which resolves on failure.
            void Promise.all([captured.current!.refresh('x'), captured.current!.refresh('y')]);
        });
        expect(new Set(captured.current!.pending)).toEqual(new Set(['x', 'y']));

        // Settled in the reverse order to the refreshes — both land.
        await act(async () => {
            yRuns[1]!.resolve('y2');
        });
        expect([...captured.current!.pending]).toEqual(['x']);
        await act(async () => {
            xRuns[1]!.resolve('x2');
        });
        expect(screen.getByText('x2/y2')).toBeTruthy();
        expect(captured.current!.pending.size).toBe(0);
    });

    // A cascade-swapped source that errors settles its swap like a first ready:
    // the key leaves `pending` before the boundary shows the error slot.
    //
    // Kill: resolver.tsx, the source error branch — drop the `sourceErrored` call → 'live'
    // stays in `pending` for the error slot's whole life.
    test('a swapped source that errors settles the swap: the error slot reads an empty pending', async () => {
        const log: string[] = [];
        let version = 1;
        const created: ControllableSource<string>[] = [];
        const testScope = scope()
            .load({ v: async () => version })
            .load({
                live: ({ v }: { v: number }) => {
                    const source = testSource<string>(log, `s${v}`);
                    created.push(source);
                    return source;
                },
            });
        const { captured, Probe } = probeControls(testScope);
        const Island = island({
            scope: testScope,
            component: ({ live }: { live: string }) => (
                <div>
                    <span>live {live}</span>
                    <Probe />
                </div>
            ),
            loading: Loading,
            error: () => (
                <div>
                    <span>failed</span>
                    <Probe />
                </div>
            ),
        });

        await act(async () => {
            render(<Island />);
        });
        act(() => created[0]!.setReady('one'));
        expect(screen.getByText('live one')).toBeTruthy();

        version = 2;
        await act(async () => {
            await captured.current!.refresh('v');
        });
        await flush();
        // Mid-swap: the replacement is warming, so the key is pending and the old
        // content bridges.
        expect(created).toHaveLength(2);
        expect([...captured.current!.pending]).toEqual(['live']);
        expect(screen.getByText('live one')).toBeTruthy();

        act(() => created[1]!.setError({ code: 'failed', message: 'boom' }));
        await flush();
        expect(screen.getByText('failed')).toBeTruthy();
        expect(captured.current!.pending.size).toBe(0);
    });
});

describe('selective refresh — cascade semantics', () => {
    // Pin 3. The cascade is transitive (a → b → c) and stops at the first link whose
    // value did not move: the `useScopeControls` promise of
    // docs/current/public/reference.md, applied at every hop.
    //
    // Kill: refresh.ts `settled()` — `const changed = true` → the equal `b` re-runs `c`.
    test('a transitive cascade: an equal middle link cuts the chain, a changed one carries it', async () => {
        let aValue = 1;
        const runs = { a: 0, b: 0, c: 0 };
        const testScope = scope()
            .load({
                a: async () => {
                    runs.a++;
                    return aValue;
                },
            })
            .load({
                // A fresh object every run — deep-equal while `a` keeps its parity.
                b: async ({ a }: { a: number }) => {
                    runs.b++;
                    return { even: a % 2 === 0 };
                },
            })
            .load({
                c: async ({ b }: { b: { even: boolean } }) => {
                    runs.c++;
                    return b.even ? 'even' : 'odd';
                },
            });
        const { captured, Probe } = probeControls(testScope);
        const Island = island({
            scope: testScope,
            component: ({ c }: { c: string }) => (
                <div>
                    <span>c {c}</span>
                    <Probe />
                </div>
            ),
            loading: Loading,
        });

        await act(async () => {
            render(<Island />);
        });
        await flush(2);
        expect(screen.getByText('c odd')).toBeTruthy();
        expect(runs).toEqual({ a: 1, b: 1, c: 1 });

        // a: 1 → 3 changed, so b re-runs — but recomputes to an equal value, and the
        // chain stops there. c never sees it.
        aValue = 3;
        await act(async () => {
            await captured.current!.refresh('a');
        });
        await flush(3);
        expect(runs).toEqual({ a: 2, b: 2, c: 1 });
        expect(screen.getByText('c odd')).toBeTruthy();

        // a: 3 → 2 flips b's value, and now the second hop carries.
        aValue = 2;
        await act(async () => {
            await captured.current!.refresh('a');
        });
        await flush(3);
        expect(runs).toEqual({ a: 3, b: 3, c: 2 });
        expect(screen.getByText('c even')).toBeTruthy();
    });

    // @kit long: 2
    // Pin 4. Read-sets re-record on every run, so a lazily-reading producer cascades from
    // what it CURRENTLY reads. Both dependent kinds are here: a promise re-run rewrites its
    // cell's read-set and a sync re-run swaps in a new cell, so a pin on one kind passes
    // while the other is frozen.
    //
    // Kill: resolver.tsx `processDirtyCells()` — drop `cell.reads = next.reads` → the
    // promise dependent's first read-set is frozen, so after the flip `refresh('b')`
    // never reaches it and `picked` stays 'b2'.
    test('a lazy read-set re-records per run: a flipped conditional read cascades from the new set', async () => {
        let useA = true;
        let aValue = 'a1';
        let bValue = 'b1';
        const runs = { picked: 0, pickedSync: 0 };
        type Bag = { flag: boolean; a: string; b: string };
        const testScope = scope()
            .load({
                flag: async () => useA,
                a: async () => aValue,
                b: async () => bValue,
            })
            .load({
                // Lazy reads: each run touches `flag` and exactly one of `a` / `b`.
                picked: async (bag: Bag) => {
                    runs.picked++;
                    return bag.flag ? bag.a : bag.b;
                },
                pickedSync: (bag: Bag) => {
                    runs.pickedSync++;
                    return bag.flag ? bag.a : bag.b;
                },
            });
        const { captured, Probe } = probeControls(testScope);
        const Island = island({
            scope: testScope,
            component: ({ picked, pickedSync }: { picked: string; pickedSync: string }) => (
                <div>
                    <span>
                        pick {picked}/{pickedSync}
                    </span>
                    <Probe />
                </div>
            ),
            loading: Loading,
        });

        await act(async () => {
            render(<Island />);
        });
        await flush();
        expect(screen.getByText('pick a1/a1')).toBeTruthy();
        expect(runs).toEqual({ picked: 1, pickedSync: 1 });

        // `b` was never read on that run — a change to it reaches nothing.
        bValue = 'b2';
        await act(async () => {
            await captured.current!.refresh('b');
        });
        await flush(2);
        expect(runs).toEqual({ picked: 1, pickedSync: 1 });
        expect(screen.getByText('pick a1/a1')).toBeTruthy();

        // The flip: both re-run over the new flag and now read `b` instead of `a`.
        useA = false;
        await act(async () => {
            await captured.current!.refresh('flag');
        });
        await flush(2);
        expect(runs).toEqual({ picked: 2, pickedSync: 2 });
        expect(screen.getByText('pick b2/b2')).toBeTruthy();

        // `a` left the read-set with the flip: it no longer cascades…
        aValue = 'a2';
        await act(async () => {
            await captured.current!.refresh('a');
        });
        await flush(2);
        expect(runs).toEqual({ picked: 2, pickedSync: 2 });
        expect(screen.getByText('pick b2/b2')).toBeTruthy();

        // …and `b`, which joined it, now does.
        bValue = 'b3';
        await act(async () => {
            await captured.current!.refresh('b');
        });
        await flush(2);
        expect(runs).toEqual({ picked: 3, pickedSync: 3 });
        expect(screen.getByText('pick b3/b3')).toBeTruthy();
    });

    // Pin 9. `data(fn, { equals })` gates THAT LOAD's value wherever the re-run came from,
    // a cascade included.
    //
    // Kill: refresh.ts `settled()` — `const equals = deepEqual` (ignore `cell.equals`)
    // → the deep comparer sees body 1 → 3, calls it changed, and `formatted` re-runs.
    test('data(fn, { equals }) gates a cascaded re-run of the dependent, not only a direct refresh', async () => {
        let aValue = 1;
        const runs = { doc: 0, formatted: 0 };
        const testScope = scope()
            .load({ a: async () => aValue })
            .load({
                doc: data(
                    async ({ a }: { a: number }) => {
                        runs.doc++;
                        // `body` moves with every `a`; the comparer only reads the etag.
                        return { etag: `e${a % 2}`, body: a };
                    },
                    { equals: (previous, next) => previous.etag === next.etag },
                ),
            })
            .load({
                formatted: ({ doc }: { doc: { etag: string; body: number } }) => {
                    runs.formatted++;
                    return `${doc.etag}/${doc.body}`;
                },
            });
        const { captured, Probe } = probeControls(testScope);
        const Island = island({
            scope: testScope,
            component: ({ formatted }: { formatted: string }) => (
                <div>
                    <span>doc {formatted}</span>
                    <Probe />
                </div>
            ),
            loading: Loading,
        });

        await act(async () => {
            render(<Island />);
        });
        await flush(2);
        expect(screen.getByText('doc e1/1')).toBeTruthy();
        expect(runs).toEqual({ doc: 1, formatted: 1 });

        // a: 1 → 3 cascades into `doc`, whose re-run keeps its etag: the cascade dies
        // on DOC'S OWN comparer, and `formatted` keeps the old value and identity.
        aValue = 3;
        await act(async () => {
            await captured.current!.refresh('a');
        });
        await flush(3);
        expect(runs).toEqual({ doc: 2, formatted: 1 });
        expect(screen.getByText('doc e1/1')).toBeTruthy();

        // a: 3 → 2 moves the etag, so the same comparer lets it through.
        aValue = 2;
        await act(async () => {
            await captured.current!.refresh('a');
        });
        await flush(3);
        expect(runs).toEqual({ doc: 3, formatted: 2 });
        expect(screen.getByText('doc e0/2')).toBeTruthy();
    });
});

describe('selective refresh — hydrated cells', () => {
    // Pin 5. A hydrated cell never ran its producer, so it has no read-set: it answers a
    // DIRECT refresh and joins the cascade only from that run on.
    //
    // Kill: resolver.tsx `buildCell()` — `rerunnable: false` on the hydration
    // short-circuit → the hydrated cell never re-runs.
    test('a hydrated cell answers a direct refresh and joins the cascade from that run on', async () => {
        let aValue = 'a1';
        const runs = { a: 0, b: 0 };
        const testScope = scope({ id: input<string>() })
            .load({
                a: async () => {
                    runs.a++;
                    return aValue;
                },
            })
            .load({
                b: async ({ a }: { a: string }) => {
                    runs.b++;
                    return `b(${a})`;
                },
            });
        const { captured, Probe } = probeControls(testScope);
        const Island = island({
            scope: testScope,
            component: ({ b }: { b: string }) => (
                <div>
                    <span>{b}</span>
                    <Probe />
                </div>
            ),
            loading: Loading,
        });

        const collector = createHydrationCollector();
        const html = await prerenderToString(
            <HydrationProvider collect={collector.collect}>
                <Island id="x" />
            </HydrationProvider>,
        );
        expect(runs).toEqual({ a: 1, b: 1 });

        const container = document.createElement('div');
        container.innerHTML = html;
        document.body.appendChild(container);
        // A producer that re-ran client-side would render the loading slot over the
        // server's ready HTML; React reports that recovery here, not on console.error.
        const recovered = vi.fn();
        await act(async () => {
            hydrateRoot(
                container,
                <HydrationProvider data={collector.data}>
                    <Island id="x" />
                </HydrationProvider>,
                { onRecoverableError: recovered },
            );
        });
        // Both keys came off the wire: neither producer ran client-side.
        expect(runs).toEqual({ a: 1, b: 1 });
        expect(container.textContent).toContain('b(a1)');
        expect(recovered).not.toHaveBeenCalled();

        // `b` never ran, so it has no read-set — a changed `a` does not reach it.
        aValue = 'a2';
        await act(async () => {
            await captured.current!.refresh('a');
        });
        await flush(2);
        expect(runs).toEqual({ a: 2, b: 1 });
        expect(container.textContent).toContain('b(a1)');

        // A direct refresh re-runs it — over the current `a`, and recording its reads.
        await act(async () => {
            await captured.current!.refresh('b');
        });
        await flush(2);
        expect(runs).toEqual({ a: 2, b: 2 });
        expect(container.textContent).toContain('b(a2)');

        // From that run on it is an ordinary cascade target.
        aValue = 'a3';
        await act(async () => {
            await captured.current!.refresh('a');
        });
        await flush(3);
        expect(runs).toEqual({ a: 3, b: 3 });
        expect(container.textContent).toContain('b(a3)');
    });
});
