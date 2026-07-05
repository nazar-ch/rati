import { describe, test, expect, afterEach } from 'vite-plus/test';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { createContext, StrictMode, useContext, type FC } from 'react';
import { scope, input, hook } from '../../scope/scope';
import { NotAvailableError, SourceSymbol, type Source, type SourceState } from '../../scope/source';
import { island } from '../../island/island';
import { useScope, useOptionalScope } from '../../mandala/channel';

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
    // Hand-rolled subscribable (the new Source contract): a listener set + a stored
    // state object whose identity changes on each transition, so getSnapshot is
    // uSES-stable. Mirrors what an adapter (e.g. rati/mobx's observableSource) does.
    let state: SourceState<T> = { status: 'pending' };
    const listeners = new Set<() => void>();
    const set = (next: SourceState<T>) => {
        state = next;
        for (const listener of listeners) listener();
    };
    return {
        [SourceSymbol]: true,
        getSnapshot: () => state,
        subscribe(onChange) {
            listeners.add(onChange);
            return () => {
                listeners.delete(onChange);
            };
        },
        attach() {
            log.push(`attach:${id}`);
            return () => log.push(`detach:${id}`);
        },
        ready: (value) => act(() => set({ status: 'ready', value })),
        fail: (code) => act(() => set({ status: 'error', error: { code } })),
        pend: () => act(() => set({ status: 'pending' })),
    };
}

describe('island', () => {
    test('shows loading, then the component with waterfall-resolved values', async () => {
        // A promise entry suspends; the loading slot is the Suspense fallback. The
        // dependent level then resolves off the first level's value.
        const name = deferred<string>();
        const Island = island({
            scope: scope({ id: input<string>() })
                .load({ name: () => name.promise })
                .load({ label: async ({ name }) => `[${name}]` }),
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

    test('a hook() load reads React context every render and feeds downstream loads', async () => {
        // The reason `env` is gone: a load reads its own deps via a hook. Here the
        // store comes from React context inside `hook(...)`, and a plain data load
        // downstream consumes the resolved value.
        const StoresContext = createContext('default');
        let calls = 0;

        const Island = island({
            scope: scope({ id: input<string>() })
                .load({
                    prefix: hook(() => {
                        calls++;
                        return useContext(StoresContext);
                    }),
                })
                .load({ label: ({ prefix, id }) => `${prefix}:${id}` }),
            component: ({ label }) => <div>hooked {label}</div>,
            loading: Loading,
        });

        await act(async () => {
            render(
                <StoresContext.Provider value="ctx">
                    <Island id="a1" />
                </StoresContext.Provider>,
            );
        });

        expect(await screen.findByText('hooked ctx:a1')).toBeTruthy();
        // The hook ran during render (not cached once like a data load).
        expect(calls).toBeGreaterThan(0);
    });

    test('forwards a wrapped lazy component preload so the island stays preloadable', () => {
        // A `lazy()` component hangs `.preload` on itself; the island must surface it
        // so the router can prefetch the chunk through the wrapper (route + lazy scope).
        const preload = () => Promise.resolve();
        const Lazy = Object.assign(() => <div>x</div>, { preload });

        const Island = island({
            scope: scope({ id: input<string>() }),
            component: Lazy,
            loading: Loading,
        });
        expect((Island as { preload?: unknown }).preload).toBe(preload);

        const Plain = island({
            scope: scope({ id: input<string>() }),
            component: () => <div>x</div>,
            loading: Loading,
        });
        expect((Plain as { preload?: unknown }).preload).toBeUndefined();
    });

    test('routes a failed source to the error slot with the unified code', async () => {
        const Island = island({
            scope: scope({ id: input<string>() }).load({
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

        const Island = island({
            scope: scope({ id: input<string>() }).load({
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

        const Island = island({
            scope: scope({ id: input<string>() }).load({ res: () => res }),
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

        const Island = island({
            scope: scope({ id: input<string>() })
                .load({ space: () => space })
                .load({ page: () => page }),
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

        const Island = island({
            scope: scope({ id: input<string>() })
                .load({ spaceId: () => spaceId.promise })
                .load({
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

        const Island = island({
            scope: scope({ id: input<string>() }).load({ res: () => res }),
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

        const Island = island({
            scope: scope({ id: input<string>() }).load({ res: ({ id }) => sourceFor(id) }),
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

    test('builds the .provide() value from the resolved chain and provides it to the subtree', async () => {
        const ctxScope = scope({ id: input<string>() })
            .load({ name: async ({ id }) => `env:${id}` })
            .provide(({ name }) => ({ label: `<${name}>` }));
        const Island = island({
            scope: ctxScope,
            component: () => <Consumer />,
            loading: Loading,
        });

        function Consumer() {
            const ctx = useScope(ctxScope);
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

        const ctxScope = scope({ id: input<string>() })
            .load({ res: () => res })
            .provide(({ res: r }) => {
                log.push('context-mount');
                return {
                    id: r.id,
                    [Symbol.dispose]() {
                        log.push('context-dispose');
                    },
                };
            });
        const Island = island({
            scope: ctxScope,
            component: () => <Mounted />,
            loading: Loading,
        });

        function Mounted() {
            const ctx = useScope(ctxScope);
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

        const Island = island({
            scope: scope({ id: input<string>() })
                .load({ res: ({ id }) => sourceFor(id) })
                .provide(({ res }) => {
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

    test('.provide({ provideTo }) also publishes the value into an app-owned context', async () => {
        const AppContext = createContext<{ label: string } | null>(null);

        const Island = island({
            scope: scope({ id: input<string>() }).provide(({ id }) => ({ label: `#${id}` }), {
                provideTo: AppContext,
            }),
            component: () => <Consumer />,
            loading: Loading,
        });

        // Reads the value through the app context — no useScope, so an app
        // consumer never has to import the island (which would cycle).
        function Consumer() {
            const ctx = useContext(AppContext);
            return <div>app {ctx?.label}</div>;
        }

        render(<Island id="a1" />);
        expect(await screen.findByText('app #a1')).toBeTruthy();
    });

    test('useOptionalScope returns the value when a context is provided above', async () => {
        const ctxScope = scope({ id: input<string>() }).provide(({ id }) => ({ label: `#${id}` }));
        const Island = island({
            scope: ctxScope,
            component: () => <Consumer />,
            loading: Loading,
        });

        function Consumer() {
            const ctx = useOptionalScope(ctxScope);
            return <div>opt {ctx ? ctx.label : 'none'}</div>;
        }

        render(<Island id="a1" />);
        expect(await screen.findByText('opt #a1')).toBeTruthy();
    });

    test('useOptionalScope returns undefined when rendered outside the island', () => {
        const ctxScope = scope({ id: input<string>() }).provide(({ id }) => ({ label: `#${id}` }));
        // Build the island so the scope's channel exists, but render the reader with no
        // <Island> above it — a present scope with no provider in the tree.
        island({ scope: ctxScope, component: () => <div>page</div>, loading: Loading });

        function Consumer() {
            const ctx = useOptionalScope(ctxScope);
            return <div>opt {ctx === undefined ? 'none' : ctx.label}</div>;
        }

        render(<Consumer />);
        expect(screen.getByText('opt none')).toBeTruthy();
    });

    test('provide-by-default: useScope returns the resolved props when the scope declares no .provide()', async () => {
        const propsScope = scope({ id: input<string>() });
        const Island = island({
            scope: propsScope,
            component: () => <Consumer />,
            loading: Loading,
        });

        // No `.provide()`, so the island provides its resolved props to the subtree.
        function Consumer() {
            const props = useScope(propsScope);
            return <div>props {props.id}</div>;
        }

        render(<Island id="a1" />);
        expect(await screen.findByText('props a1')).toBeTruthy();
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
            const state: SourceState<{ id: string }> = { status: 'ready', value: { id } };
            const source: Source<{ id: string }> = {
                [SourceSymbol]: true,
                getSnapshot: () => state,
                subscribe: () => () => {},
                attach() {
                    log.push(`attach:${id}`);
                    return () => log.push(`detach:${id}`);
                },
            };
            return source;
        };
    }

    test('StrictMode: useScope sees the surviving run, discarded context disposed before its source detaches', async () => {
        const log: string[] = [];
        const makeSource = readySourceFactory(log);

        const ctxScope = scope({ id: input<string>() })
            .load({ res: () => makeSource() })
            .provide(({ res }) => {
                log.push(`build:${res.id}`);
                return {
                    id: res.id,
                    [Symbol.dispose]() {
                        log.push(`dispose:${res.id}`);
                    },
                };
            });
        const Island = island({
            scope: ctxScope,
            component: () => <Consumer />,
            loading: Loading,
        });

        function Consumer() {
            const ctx = useScope(ctxScope);
            return <div>live {ctx.id}</div>;
        }

        render(
            <StrictMode>
                <Island id="a1" />
            </StrictMode>,
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

        const Island = island({
            scope: scope({ id: input<string>() })
                .load({ res: () => makeSource() })
                .provide(({ res }) => ({ id: res.id }), { provideTo: AppContext }),
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
            </StrictMode>,
        );

        expect(await screen.findByText('app src2')).toBeTruthy();
    });

    test('StrictMode: plain resolved props come from the surviving run', async () => {
        const log: string[] = [];
        const makeSource = readySourceFactory(log);

        const Island = island({
            scope: scope({ id: input<string>() }).load({ res: () => makeSource() }),
            component: ({ res }) => <div>input {res.id}</div>,
            loading: Loading,
        });

        render(
            <StrictMode>
                <Island id="a1" />
            </StrictMode>,
        );

        expect(await screen.findByText('input src2')).toBeTruthy();
        // Run #1's source was attached then detached; run #2's stays attached.
        expect(log).toContain('detach:src1');
        expect(log).not.toContain('detach:src2');
    });

    test('islands sharing a scope each provide their own value; a by-scope reader gets the nearest', async () => {
        // The reuse case: two distinct islands built from the *same* scope. They share
        // one value channel (scope identity), but each renders its own Provider subtree,
        // so a by-scope reader under each gets that island's value — nearest wins, no
        // cross-talk. (Nesting two of the same scope is the only ambiguous case, and
        // then nearest-wins is the sane default.)
        const sharedScope = scope({ id: input<string>() }).provide(({ id }) => ({ tag: `#${id}` }));
        const First = island({
            scope: sharedScope,
            component: () => <Reader />,
            loading: Loading,
        });
        const Second = island({
            scope: sharedScope,
            component: () => <Reader />,
            loading: Loading,
        });

        function Reader() {
            const { tag } = useScope(sharedScope);
            return <div>tag {tag}</div>;
        }

        await act(async () => {
            render(
                <>
                    <First id="a" />
                    <Second id="b" />
                </>,
            );
        });

        expect(await screen.findByText('tag #a')).toBeTruthy();
        expect(await screen.findByText('tag #b')).toBeTruthy();
    });
});
