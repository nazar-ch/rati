import { describe, test, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { observable, runInAction } from 'mobx';
import { createContext, StrictMode, useContext, type FC } from 'react';
import { createView, viewParam } from '../common/view';
import { NotAvailableError, SourceSymbol, type Source, type SourceState } from '../common/source';
import { createIsland, useIslandContext, useOptionalIslandContext } from '../experimental/island';

type TestEnv = { prefix: string };

const Loading: FC = () => <div>loading...</div>;

afterEach(cleanup);

// A promise the test resolves by hand, so a suspended (Suspense) render can be
// observed in its loading state before the value lands.
function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

// A hand-rolled source the test drives, logging attach/detach so lifetime is
// observable. Mirrors what a CRDT/REST adapter implements.
type TestSource<T> = Source<T> & {
    ready: (value: T) => void;
    fail: (code: string) => void;
    pend: () => void;
};

function testSource<T>(log: string[], id: string): TestSource<T> {
    const box = observable.box<SourceState<T>>({ status: 'pending' }, { deep: false });
    return {
        [SourceSymbol]: true,
        get state() {
            return box.get();
        },
        attach() {
            log.push(`attach:${id}`);
            return () => log.push(`detach:${id}`);
        },
        ready: (value) => act(() => runInAction(() => box.set({ status: 'ready', value }))),
        fail: (code) => act(() => runInAction(() => box.set({ status: 'error', error: { code } }))),
        pend: () => act(() => runInAction(() => box.set({ status: 'pending' }))),
    };
}

describe('createIsland', () => {
    test('shows loading, then the component with waterfall-resolved values', async () => {
        // A promise entry suspends; the loading slot is the Suspense fallback. The
        // dependent level then resolves off the first level's value.
        const name = deferred<string>();
        const Island = createIsland({
            useEnv: () => ({ prefix: 'env' }) as TestEnv,
            view: () =>
                createView
                    .chain({ id: viewParam<string>() })
                    .chain({ name: () => name.promise })
                    .chain({ label: async ({ name }) => `[${name}]` }),
            component: ({ label }) => <div>ready {label}</div>,
            loading: Loading,
        });

        await act(async () => {
            render(<Island id="a1" />);
        });
        expect(screen.getByText('loading...')).toBeTruthy();

        await act(async () => {
            name.resolve('env:a1');
        });
        expect(await screen.findByText('ready [env:a1]')).toBeTruthy();
    });

    test('forwards a wrapped lazy component preload so the island stays preloadable', () => {
        // A `lazy()` component hangs `.preload` on itself; the island must surface it
        // so the router can prefetch the chunk through the wrapper (route2 + lazy view).
        const preload = () => Promise.resolve();
        const Lazy = Object.assign(() => <div>x</div>, { preload });

        const Island = createIsland({
            useEnv: () => ({}),
            view: () => createView.chain({ id: viewParam<string>() }),
            component: Lazy,
            loading: Loading,
        });
        expect((Island as { preload?: unknown }).preload).toBe(preload);

        const Plain = createIsland({
            useEnv: () => ({}),
            view: () => createView.chain({ id: viewParam<string>() }),
            component: () => <div>x</div>,
            loading: Loading,
        });
        expect((Plain as { preload?: unknown }).preload).toBeUndefined();
    });

    test('routes a failed source to the error slot with the unified code', async () => {
        const Island = createIsland({
            useEnv: () => ({ prefix: 'env' }) as TestEnv,
            view: () =>
                createView.chain({ id: viewParam<string>() }).chain({
                    page: async (): Promise<string> => {
                        throw new NotAvailableError('no such page', { code: 'not-available' });
                    },
                }),
            component: () => <div>ready</div>,
            loading: Loading,
            error: ({ error }) => <div>error: {error.code}</div>,
        });

        await act(async () => {
            render(<Island id="a1" />);
        });

        expect(await screen.findByText('error: not-available')).toBeTruthy();
    });

    test('renders the error slot and retries successfully', async () => {
        let failures = 1;

        const Island = createIsland({
            useEnv: () => ({ prefix: 'env' }) as TestEnv,
            view: () =>
                createView.chain({ id: viewParam<string>() }).chain({
                    data: async ({ id }) => {
                        if (failures > 0) {
                            failures--;
                            throw new Error('boom');
                        }
                        return `data:${id}`;
                    },
                }),
            component: ({ data }) => <div>ready {data}</div>,
            loading: Loading,
            error: ({ retry }) => (
                <button type="button" onClick={retry}>
                    retry
                </button>
            ),
        });

        await act(async () => {
            render(<Island id="a1" />);
        });

        const retryButton = await screen.findByText('retry');
        await act(async () => {
            fireEvent.click(retryButton);
        });

        expect(await screen.findByText('ready data:a1')).toBeTruthy();
    });

    test('attaches sources and detaches them on unmount', async () => {
        const log: string[] = [];
        const res = testSource<{ id: string }>(log, 'res');

        const Island = createIsland({
            useEnv: () => ({ prefix: 'env' }) as TestEnv,
            view: () => createView.chain({ id: viewParam<string>() }).chain({ res: () => res }),
            component: ({ res: r }) => <div>ready {r.id}</div>,
            loading: Loading,
        });

        const { unmount } = render(<Island id="a1" />);
        expect(log).toContain('attach:res');

        res.ready({ id: 'a1' });
        await screen.findByText('ready a1');

        unmount();
        expect(log).toContain('detach:res');
    });

    test('builds a dependent level only once the prior source is ready', async () => {
        const log: string[] = [];
        const space = testSource<string>(log, 'space');
        const page = testSource<{ id: string }>(log, 'page');

        const Island = createIsland({
            useEnv: () => ({ prefix: 'env' }) as TestEnv,
            view: () =>
                createView
                    .chain({ id: viewParam<string>() })
                    .chain({ space: () => space })
                    .chain({ page: () => page }),
            component: ({ page: p }) => <div>ready {p.id}</div>,
            loading: Loading,
        });

        render(<Island id="a1" />);

        // The page level must not be built until `space` is ready.
        expect(log).toContain('attach:space');
        expect(log).not.toContain('attach:page');

        space.ready('s1');
        expect(log).toContain('attach:page');

        page.ready({ id: 'p1' });
        expect(await screen.findByText('ready p1')).toBeTruthy();
    });

    test('resolves a source level that depends on a promise level', async () => {
        // The page route's shape: a promise (slug → spaceId) feeds a source (the doc
        // keyed by that id). The source level can't build until the promise resolves.
        const log: string[] = [];
        const spaceId = deferred<string>();
        const tree = testSource<{ id: string }>(log, 'tree');

        const Island = createIsland({
            useEnv: () => ({ prefix: 'env' }) as TestEnv,
            view: () =>
                createView
                    .chain({ id: viewParam<string>() })
                    .chain({ spaceId: () => spaceId.promise })
                    .chain({
                        tree: ({ spaceId }) => {
                            log.push(`build-tree:${spaceId}`);
                            return tree;
                        },
                    }),
            component: ({ tree: t }) => <div>ready {t.id}</div>,
            loading: Loading,
        });

        await act(async () => {
            render(<Island id="a1" />);
        });
        // Suspended on the promise — the source level hasn't been built yet.
        expect(screen.getByText('loading...')).toBeTruthy();
        expect(log).not.toContain('build-tree:s1');

        await act(async () => {
            spaceId.resolve('s1');
        });
        // The promise resolved, so the source level builds (with the resolved id) and
        // attaches; still loading until the source itself is ready.
        expect(log).toContain('build-tree:s1');
        expect(log).toContain('attach:tree');

        tree.ready({ id: 'p1' });
        expect(await screen.findByText('ready p1')).toBeTruthy();
    });

    test('a ready source returning to pending drops back to loading', async () => {
        const log: string[] = [];
        const res = testSource<{ id: string }>(log, 'res');

        const Island = createIsland({
            useEnv: () => ({ prefix: 'env' }) as TestEnv,
            view: () => createView.chain({ id: viewParam<string>() }).chain({ res: () => res }),
            component: ({ res: r }) => <div>ready {r.id}</div>,
            loading: Loading,
        });

        render(<Island id="a1" />);
        res.ready({ id: 'a1' });
        await screen.findByText('ready a1');

        res.pend();
        expect(await screen.findByText('loading...')).toBeTruthy();
    });

    test('detaches the previous run and re-resolves when params change', async () => {
        const log: string[] = [];
        const sources = new Map<string, TestSource<{ id: string }>>();
        const sourceFor = (id: string) => {
            let source = sources.get(id);
            if (!source) {
                source = testSource<{ id: string }>(log, id);
                sources.set(id, source);
            }
            return source;
        };

        const Island = createIsland({
            useEnv: () => ({ prefix: 'env' }) as TestEnv,
            view: () =>
                createView
                    .chain({ id: viewParam<string>() })
                    .chain({ res: ({ id }) => sourceFor(id) }),
            component: ({ res }) => <div>ready {res.id}</div>,
            loading: Loading,
        });

        const { rerender } = render(<Island id="a1" />);
        sourceFor('a1').ready({ id: 'a1' });
        await screen.findByText('ready a1');

        rerender(<Island id="a2" />);
        expect(log).toContain('detach:a1');

        sourceFor('a2').ready({ id: 'a2' });
        expect(await screen.findByText('ready a2')).toBeTruthy();
    });

    test('builds the .context() value from the resolved chain and provides it to the subtree', async () => {
        const Island = createIsland({
            useEnv: () => ({ prefix: 'env' }) as TestEnv,
            view: (env) =>
                createView
                    .chain({ id: viewParam<string>() })
                    .chain({ name: async ({ id }) => `${env.prefix}:${id}` })
                    .context(({ name }) => ({ label: `<${name}>` })),
            component: () => <Consumer />,
            loading: Loading,
        });

        function Consumer() {
            const ctx = useIslandContext(Island);
            return <div>ctx {ctx.label}</div>;
        }

        await act(async () => {
            render(<Island id="a1" />);
        });
        expect(await screen.findByText('ctx <env:a1>')).toBeTruthy();
    });

    test('disposes the context before detaching the sources it was built from', async () => {
        const log: string[] = [];
        const res = testSource<{ id: string }>(log, 'res');

        const Island = createIsland({
            useEnv: () => ({ prefix: 'env' }) as TestEnv,
            view: () =>
                createView
                    .chain({ id: viewParam<string>() })
                    .chain({ res: () => res })
                    .context(({ res: r }) => {
                        log.push('context-mount');
                        return {
                            id: r.id,
                            [Symbol.dispose]() {
                                log.push('context-dispose');
                            },
                        };
                    }),
            component: () => <Mounted />,
            loading: Loading,
        });

        function Mounted() {
            const ctx = useIslandContext(Island);
            return <div>ctx {ctx.id}</div>;
        }

        const { unmount } = render(<Island id="a1" />);
        res.ready({ id: 'a1' });
        await screen.findByText('ctx a1');
        expect(log).toContain('context-mount');

        unmount();
        // The context teardown must run while the grab is still live — i.e. before
        // the source it was built from detaches.
        expect(log.indexOf('context-dispose')).toBeLessThan(log.indexOf('detach:res'));
    });

    test('rebuilds the context on param change, disposing the previous one first', async () => {
        const log: string[] = [];
        const sources = new Map<string, TestSource<{ id: string }>>();
        const sourceFor = (id: string) => {
            let source = sources.get(id);
            if (!source) {
                source = testSource<{ id: string }>(log, id);
                sources.set(id, source);
            }
            return source;
        };

        const Island = createIsland({
            useEnv: () => ({ prefix: 'env' }) as TestEnv,
            view: () =>
                createView
                    .chain({ id: viewParam<string>() })
                    .chain({ res: ({ id }) => sourceFor(id) })
                    .context(({ res }) => {
                        log.push(`context-mount:${res.id}`);
                        return {
                            id: res.id,
                            [Symbol.dispose]() {
                                log.push(`context-dispose:${res.id}`);
                            },
                        };
                    }),
            component: ({ res }) => <div>ready {res.id}</div>,
            loading: Loading,
        });

        const { rerender } = render(<Island id="a1" />);
        sourceFor('a1').ready({ id: 'a1' });
        await screen.findByText('ready a1');
        expect(log).toContain('context-mount:a1');

        rerender(<Island id="a2" />);
        expect(log.indexOf('context-dispose:a1')).toBeLessThan(log.indexOf('detach:a1'));

        sourceFor('a2').ready({ id: 'a2' });
        await screen.findByText('ready a2');
        expect(log).toContain('context-mount:a2');
    });

    test('.context({ provideTo }) also publishes the value into an app-owned context', async () => {
        const AppContext = createContext<{ label: string } | null>(null);

        const Island = createIsland({
            useEnv: () => ({ prefix: 'env' }) as TestEnv,
            view: () =>
                createView
                    .chain({ id: viewParam<string>() })
                    .context(({ id }) => ({ label: `#${id}` }), { provideTo: AppContext }),
            component: () => <Consumer />,
            loading: Loading,
        });

        // Reads the value through the app context — no useIslandContext, so an app
        // consumer never has to import the island (which would cycle).
        function Consumer() {
            const ctx = useContext(AppContext);
            return <div>app {ctx?.label}</div>;
        }

        render(<Island id="a1" />);
        expect(await screen.findByText('app #a1')).toBeTruthy();
    });

    test('useOptionalIslandContext returns the value when a context is provided above', async () => {
        const Island = createIsland({
            useEnv: () => ({ prefix: 'env' }) as TestEnv,
            view: () =>
                createView
                    .chain({ id: viewParam<string>() })
                    .context(({ id }) => ({ label: `#${id}` })),
            component: () => <Consumer />,
            loading: Loading,
        });

        function Consumer() {
            const ctx = useOptionalIslandContext(Island);
            return <div>opt {ctx ? ctx.label : 'none'}</div>;
        }

        render(<Island id="a1" />);
        expect(await screen.findByText('opt #a1')).toBeTruthy();
    });

    test('useOptionalIslandContext returns undefined when rendered outside the island', () => {
        const Island = createIsland({
            useEnv: () => ({ prefix: 'env' }) as TestEnv,
            view: () =>
                createView
                    .chain({ id: viewParam<string>() })
                    .context(({ id }) => ({ label: `#${id}` })),
            component: () => <div>page</div>,
            loading: Loading,
        });

        // Rendered standalone — no <Island> above, so no context value is in scope.
        function Consumer() {
            const ctx = useOptionalIslandContext(Island);
            return <div>opt {ctx === undefined ? 'none' : ctx.label}</div>;
        }

        render(<Consumer />);
        expect(screen.getByText('opt none')).toBeTruthy();
    });

    test('useOptionalIslandContext returns undefined under an island whose view declares no .context()', async () => {
        const Island = createIsland({
            useEnv: () => ({ prefix: 'env' }) as TestEnv,
            view: () => createView.chain({ id: viewParam<string>() }),
            component: () => <Consumer />,
            loading: Loading,
        });

        function Consumer() {
            const ctx = useOptionalIslandContext(Island);
            return <div>opt {ctx === undefined ? 'none' : 'some'}</div>;
        }

        render(<Island id="a1" />);
        expect(await screen.findByText('opt none')).toBeTruthy();
    });

    // StrictMode mounts, tears down, then remounts on the initial commit. Each
    // remount builds a *fresh* run (new sources, new context). These tests pin that
    // the subtree ends up reading the surviving run's identities — never a value
    // from the discarded first run — and that the discarded context is disposed
    // while its own source is still attached.

    // A source that is ready immediately, tagged with a per-build identity so run #1
    // and run #2 are distinguishable. Logs attach/detach so teardown is observable.
    function readySourceFactory(log: string[]) {
        let seq = 0;
        return () => {
            const id = `src${++seq}`;
            const source: Source<{ id: string }> = {
                [SourceSymbol]: true,
                get state(): SourceState<{ id: string }> {
                    return { status: 'ready', value: { id } };
                },
                attach() {
                    log.push(`attach:${id}`);
                    return () => log.push(`detach:${id}`);
                },
            };
            return source;
        };
    }

    test('StrictMode: useIslandContext sees the surviving run, discarded context disposed before its source detaches', async () => {
        const log: string[] = [];
        const makeSource = readySourceFactory(log);

        const Island = createIsland({
            useEnv: () => ({ prefix: 'env' }) as TestEnv,
            view: () =>
                createView
                    .chain({ id: viewParam<string>() })
                    .chain({ res: () => makeSource() })
                    .context(({ res }) => {
                        log.push(`build:${res.id}`);
                        return {
                            id: res.id,
                            [Symbol.dispose]() {
                                log.push(`dispose:${res.id}`);
                            },
                        };
                    }),
            component: () => <Consumer />,
            loading: Loading,
        });

        function Consumer() {
            const ctx = useIslandContext(Island);
            return <div>live {ctx.id}</div>;
        }

        render(
            <StrictMode>
                <Island id="a1" />
            </StrictMode>
        );

        // The subtree reads the second (surviving) run's context, not the first.
        expect(await screen.findByText('live src2')).toBeTruthy();
        // The discarded first context was disposed before its source detached…
        expect(log.indexOf('dispose:src1')).toBeLessThan(log.indexOf('detach:src1'));
        // …and the survivor's context is not disposed while it is live.
        expect(log).not.toContain('dispose:src2');
    });

    test('StrictMode: a provideTo app context also ends up holding the surviving identity', async () => {
        const log: string[] = [];
        const makeSource = readySourceFactory(log);
        const AppContext = createContext<{ id: string } | null>(null);

        const Island = createIsland({
            useEnv: () => ({ prefix: 'env' }) as TestEnv,
            view: () =>
                createView
                    .chain({ id: viewParam<string>() })
                    .chain({ res: () => makeSource() })
                    .context(({ res }) => ({ id: res.id }), { provideTo: AppContext }),
            component: () => <Consumer />,
            loading: Loading,
        });

        function Consumer() {
            const ctx = useContext(AppContext);
            return <div>app {ctx?.id}</div>;
        }

        render(
            <StrictMode>
                <Island id="a1" />
            </StrictMode>
        );

        expect(await screen.findByText('app src2')).toBeTruthy();
    });

    test('StrictMode: plain resolved props come from the surviving run', async () => {
        const log: string[] = [];
        const makeSource = readySourceFactory(log);

        const Island = createIsland({
            useEnv: () => ({ prefix: 'env' }) as TestEnv,
            view: () =>
                createView.chain({ id: viewParam<string>() }).chain({ res: () => makeSource() }),
            component: ({ res }) => <div>prop {res.id}</div>,
            loading: Loading,
        });

        render(
            <StrictMode>
                <Island id="a1" />
            </StrictMode>
        );

        expect(await screen.findByText('prop src2')).toBeTruthy();
        // Run #1's source was attached then detached; run #2's stays attached.
        expect(log).toContain('detach:src1');
        expect(log).not.toContain('detach:src2');
    });
});
