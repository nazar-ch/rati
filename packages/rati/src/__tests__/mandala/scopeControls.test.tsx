import { describe, test, expect, afterEach, vi } from 'vite-plus/test';
import { render, screen, cleanup, act } from '@testing-library/react';
import { hydrateRoot } from 'react-dom/client';
import type { FC, ReactElement } from 'react';
import { scope, data, input } from '../../scope/scope';
import { island } from '../../island/island';
import { createHydrationCollector, HydrationProvider } from '../../mandala/hydration';
import { useScopeControls, type ScopeControls } from '../../mandala/controls';
import {
    controllableSource,
    deferred,
    flush,
    prerenderToString,
    type ControllableSource,
} from '../../testing';

const Loading: FC = () => <div>loading...</div>;

afterEach(cleanup);

// A hand-driven source keyed into a shared attach/detach log, so a cascade's source swap is
// observable per generation (attach:s1 / detach:s1 / attach:s2). Built on the entry's
// controllableSource — the id-keyed log is the test-specific part, wired through its
// lifecycle hooks; drive it with `act(() => src.setReady(v))` / `act(() => src.setError(e))`.
function testSource<T>(log: string[], id: string): ControllableSource<T> {
    return controllableSource<T>({
        onAttach: () => log.push(`attach:${id}`),
        onDetach: () => log.push(`detach:${id}`),
    });
}

// Renders inside the island's subtree and hands the test the current controls value.
function probeControls<S extends Parameters<typeof useScopeControls>[0]>(testScope: S) {
    const captured: { current: ScopeControls<S> | null } = { current: null };
    const Probe: FC = () => {
        captured.current = useScopeControls(testScope);
        return null;
    };
    return { captured, Probe };
}

describe('useScopeControls — selective refresh', () => {
    test('refresh(key) re-runs one load and keeps the previous content in flight', async () => {
        const runs: { promise: Promise<string>; resolve: (v: string) => void }[] = [];
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
        expect(runs).toHaveLength(1);

        // Refresh: the producer re-runs, the old content stays — no loading slot.
        let settled: Promise<void>;
        await act(async () => {
            settled = captured.current!.refresh('greeting');
        });
        expect(runs).toHaveLength(2);
        expect(screen.getByText('value v1')).toBeTruthy();
        expect(screen.queryByText('loading...')).toBeNull();
        expect([...captured.current!.pending]).toEqual(['greeting']);

        await act(async () => {
            runs[1]!.resolve('v2');
            await settled;
        });
        expect(screen.getByText('value v2')).toBeTruthy();
        expect(captured.current!.pending.size).toBe(0);
    });

    test('an unchanged re-fetch (deep-equal) keeps the old value and skips the cascade', async () => {
        let listRuns = 0;
        let derivedRuns = 0;
        const testScope = scope()
            // A fresh object every run — deep-equal to the last, so the gate holds.
            .load({
                list: async () => {
                    listRuns++;
                    return { items: [1, 2] };
                },
            })
            .load({
                derived: ({ list }: { list: { items: number[] } }) => {
                    derivedRuns++;
                    return list.items.length;
                },
            });
        const seenLists: unknown[] = [];
        const { captured, Probe } = probeControls(testScope);
        const Island = island({
            scope: testScope,
            component: ({ list, derived }: { list: { items: number[] }; derived: number }) => {
                seenLists.push(list);
                return (
                    <div>
                        <span>len {derived}</span>
                        <Probe />
                    </div>
                );
            },
            loading: Loading,
        });

        await act(async () => {
            render(<Island />);
        });
        expect(await screen.findByText('len 2')).toBeTruthy();
        expect(listRuns).toBe(1);
        expect(derivedRuns).toBe(1);

        await act(async () => {
            await captured.current!.refresh('list');
        });
        await act(async () => {});

        expect(listRuns).toBe(2);
        // The gate held: the dependent never re-ran and the rendered identity is stable.
        expect(derivedRuns).toBe(1);
        expect(new Set(seenLists).size).toBe(1);
    });

    test('a changed re-fetch cascades to the loads that read the key — and only those', async () => {
        let aValue = 1;
        let aRuns = 0;
        let bRuns = 0;
        let cRuns = 0;
        const testScope = scope()
            .load({
                a: async () => {
                    aRuns++;
                    return aValue;
                },
            })
            .load({
                b: async ({ a }: { a: number }) => {
                    bRuns++;
                    return `b${a}`;
                },
                c: async () => {
                    cRuns++;
                    return 'c-stable';
                },
            });
        const { captured, Probe } = probeControls(testScope);
        const Island = island({
            scope: testScope,
            component: ({ b, c }: { b: string; c: string }) => (
                <div>
                    <span>
                        {b} {c}
                    </span>
                    <Probe />
                </div>
            ),
            loading: Loading,
        });

        await act(async () => {
            render(<Island />);
        });
        expect(await screen.findByText('b1 c-stable')).toBeTruthy();

        aValue = 2;
        await act(async () => {
            await captured.current!.refresh('a');
        });
        // The cascade's own re-fetch (b) settles on the following flush.
        await act(async () => {});

        expect(await screen.findByText('b2 c-stable')).toBeTruthy();
        expect(aRuns).toBe(2);
        expect(bRuns).toBe(2);
        // c read nothing that changed — never re-ran.
        expect(cRuns).toBe(1);
    });

    test('data(fn, { equals }) overrides the gate — an etag match suppresses the change', async () => {
        let docRuns = 0;
        let formattedRuns = 0;
        const testScope = scope()
            .load({
                doc: data(
                    async () => {
                        docRuns++;
                        // `body` differs every run; the custom comparer only reads etag.
                        return { etag: 'e1', body: docRuns };
                    },
                    { equals: (a, b) => a.etag === b.etag },
                ),
            })
            .load({
                formatted: ({ doc }: { doc: { etag: string; body: number } }) => {
                    formattedRuns++;
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
        expect(await screen.findByText('doc e1/1')).toBeTruthy();

        await act(async () => {
            await captured.current!.refresh('doc');
        });
        await act(async () => {});

        expect(docRuns).toBe(2);
        expect(formattedRuns).toBe(1);
        // Deep equality would have called this changed (body 1 → 2); the etag gate held.
        expect(screen.getByText('doc e1/1')).toBeTruthy();
    });

    test('refresh() with no key re-resolves the whole scope through the loading slot', async () => {
        const runs: { promise: Promise<string>; resolve: (v: string) => void }[] = [];
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

        await act(async () => {
            void captured.current!.refresh();
        });
        // Full re-resolve: the inner tree remounted, fresh load, loading slot back up.
        expect(runs).toHaveLength(2);
        expect(screen.getByText('loading...')).toBeTruthy();

        await act(async () => {
            runs[1]!.resolve('v2');
        });
        expect(screen.getByText('value v2')).toBeTruthy();
    });

    test('a failed re-fetch keeps the previous value and resolves (logging the failure)', async () => {
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        let fail = false;
        const testScope = scope().load({
            greeting: async () => {
                if (fail) throw new Error('boom');
                return 'v1';
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
        expect(await screen.findByText('value v1')).toBeTruthy();

        fail = true;
        await act(async () => {
            await captured.current!.refresh('greeting');
        });

        expect(screen.getByText('value v1')).toBeTruthy();
        expect(captured.current!.pending.size).toBe(0);
        expect(
            errorSpy.mock.calls.some((args) =>
                String(args[0]).includes("refresh('greeting') failed"),
            ),
        ).toBe(true);
        errorSpy.mockRestore();
    });

    test('refresh on a source key warns and no-ops — sources refresh themselves', async () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const log: string[] = [];
        const live = testSource<string>(log, 'live');
        const testScope = scope().load({ feed: () => live });
        const { captured, Probe } = probeControls(testScope);
        const Island = island({
            scope: testScope,
            component: ({ feed }) => (
                <div>
                    <span>feed {feed}</span>
                    <Probe />
                </div>
            ),
            loading: Loading,
        });

        await act(async () => {
            render(<Island />);
        });
        act(() => live.setReady('on'));
        expect(screen.getByText('feed on')).toBeTruthy();

        await act(async () => {
            await captured.current!.refresh('feed');
        });
        expect(
            warnSpy.mock.calls.some((args) => String(args[0]).includes('sources are live')),
        ).toBe(true);
        expect(screen.getByText('feed on')).toBeTruthy();
        warnSpy.mockRestore();
    });

    test('a cascade re-creates a downstream source: old detaches, stale content bridges the swap', async () => {
        const log: string[] = [];
        let version = 1;
        const created: ControllableSource<string>[] = [];
        const testScope = scope()
            .load({
                v: async () => version,
            })
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
        });

        await act(async () => {
            render(<Island />);
        });
        act(() => created[0]!.setReady('one'));
        expect(screen.getByText('live one')).toBeTruthy();
        expect(log).toContain('attach:s1');

        version = 2;
        await act(async () => {
            await captured.current!.refresh('v');
        });
        await act(async () => {});

        // The dependent source was re-created; the old one released, the new attached.
        expect(created).toHaveLength(2);
        expect(log).toContain('attach:s2');
        expect(log).toContain('detach:s1');
        // The swap bridges with the pre-swap content instead of the loading slot.
        expect(screen.getByText('live one')).toBeTruthy();
        expect(screen.queryByText('loading...')).toBeNull();

        act(() => created[1]!.setReady('two'));
        expect(screen.getByText('live two')).toBeTruthy();
    });

    test('a changed refresh rebuilds a .provide() value whose factory consumed the key', async () => {
        const events: string[] = [];
        let version = 1;
        const testScope = scope()
            .load({
                a: async () => version,
            })
            .provide(({ a }: { a: number }) => {
                events.push(`build:${a}`);
                return {
                    label: `ctx${a}`,
                    [Symbol.dispose]: () => events.push(`dispose:${a}`),
                };
            });
        const { captured, Probe } = probeControls(testScope);
        const Island = island({
            scope: testScope,
            component: () => (
                <div>
                    <span>ready</span>
                    <Probe />
                </div>
            ),
            loading: Loading,
        });

        await act(async () => {
            render(<Island />);
        });
        expect(await screen.findByText('ready')).toBeTruthy();
        expect(events).toEqual(['build:1']);

        version = 2;
        await act(async () => {
            await captured.current!.refresh('a');
        });
        await act(async () => {});

        // The stale provided value disposed before the fresh one built over the new data.
        expect(events).toEqual(['build:1', 'dispose:1', 'build:2']);
    });
});

/*
    The deterministic pins for the refresh machinery (MF-05; the list they implement is
    docs/archive/mandala-testing.md §"Deterministic pins"). Each carries a *kill note* —
    the one-line source mutation that must make it fail, executed once at authoring and
    reverted. They guard the contract stated in docs/current/public/reference.md
    §useScopeControls, never the mechanism (§"The altitude rule").
*/

describe('selective refresh — races', () => {
    // Pin 1. The race guard: the newest re-run of a key wins, whenever the older one
    // lands. `refresh(key)`'s promise "resolves when the key settles" for both callers.
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

    // Pin 2. A remount (inputs change / retry) discards the cells a refresh was
    // re-running: the bookkeeping settles wholesale rather than waiting for a settle
    // that can no longer apply, and the late settle finds a tree it must not touch.
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
        // *old* tree's last render, holding a snapshot from before the remount (S11).
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
    // Kill: refresh.ts `settled()` — make the guard global instead of per cell
    // (`cell.refreshing?.token !== this.tokens`) → the later refresh supersedes the
    // earlier *key* and x never leaves 'x1'.
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
            void captured.current!.refresh('x');
            void captured.current!.refresh('y');
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

    // Follow-up pin (2026-07-15; MF-02 left this standing as an observation, promoted to a
    // fix): a cascade-swapped source that errors settles its swap the way a first ready
    // would — an error is a settled state, not an in-flight one, so the key leaves
    // `pending` before the boundary shows the error slot. It used to sit there until a
    // retry's `treeCommitted`, so the error slot read a `pending` with nothing actually
    // fetching. Effort record: docs/planned/mandala-fuzz/README.md §Findings.
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
    // Pin 3. The cascade is transitive (a → b → c), and it stops at the first link
    // whose value did not move: "a changed value re-runs exactly the downstream loads
    // whose producers read the key" (reference.md §useScopeControls), applied at every
    // hop rather than just the first.
    //
    // Kill: refresh.ts `settled()` — `const changed = true` → the equal `b` re-runs `c`
    // anyway and cRuns is 2 after the first refresh.
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

    // Pin 4. Read-sets are re-recorded on every run, so a producer that reads lazily
    // (`(bag) => bag.x`, not destructuring) cascades from whatever it *currently*
    // reads — a key it stopped reading drops out, a key it started reading joins.
    // Both dependent kinds are here because they re-record by different means: a
    // promise re-run rewrites the read-set on the cell it keeps, a sync value re-run
    // swaps in a whole new cell that carries it. A pin on one kind alone passes while
    // the other is frozen (found by executing the kill below against a sync-only pin).
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

    // Pin 9. `data(fn, { equals })` is the gate on *that load's* value, wherever the
    // re-run came from — a cascade re-run of the dependent goes through its own
    // comparer exactly like a direct `refresh(key)` does.
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
        // on *doc's own* comparer, and `formatted` keeps the old value and identity.
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
    // Pin 5. A hydrated cell short-circuits to its server value, so its producer never
    // ran and it carries no read-set. The documented asymmetry
    // (directions-2026-07/mandala-refresh-and-ssr-sources.md §Caveats): it answers a
    // *direct* refresh, but joins the cascade only once that first re-run records what
    // it reads. This pin is a change detector on that asymmetry, not an endorsement —
    // if hydrated cells ever gain a read-set up front, it should fail and be rewritten.
    //
    // Kill: resolver.tsx `buildCell()`, the hydration short-circuit — `rerunnable:
    // false` → refresh('a') warns and no-ops, and the hydrated cell never re-runs.
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
