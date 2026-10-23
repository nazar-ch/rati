import { describe, test, expect, afterEach, vi } from 'vite-plus/test';

import type { FC } from 'react';

import { render, screen, cleanup, act } from '@testing-library/react';

import { probeControls, testSource } from './scopeControlsHarness.js';

import { island } from '../../island/island.js';
import { scope, data } from '../../scope/scope.js';
import { deferred, type ControllableSource } from '../../testing/index.js';

const Loading: FC = () => <div>loading...</div>;

afterEach(cleanup);

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
            // why-void: the case reads the effects, never the promise, which resolves on failure.
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
