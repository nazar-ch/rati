import { describe, test, expect, afterEach } from 'vite-plus/test';
// RTL is kept for the two mounts that are *not* a single island (a bare reader with no
// island above; two sibling islands sharing a scope) — renderIsland covers everything else.
import { render, screen, cleanup as rtlCleanup } from '@testing-library/react';
import { act, createContext, StrictMode, useContext, type FC } from 'react';
import { scope, input, hook } from '../../scope/scope';
import { NotAvailableError } from '../../scope/source';
import { island } from '../../island/island';
import { useScope, useOptionalScope } from '../../mandala/channel';
import {
    controllableSource,
    deferred,
    flush,
    renderIsland,
    cleanup,
    type ControllableSource,
} from '../../testing';

const Loading: FC = () => <div>loading...</div>;

afterEach(() => {
    cleanup();
    rtlCleanup();
});

describe('island', () => {
    test('shows loading, then the component with waterfall-resolved values', async () => {
        // A promise entry suspends; the loading slot is the Suspense fallback. The
        // dependent level then resolves off the first level's value.
        const name = deferred<string>();
        const handle = await renderIsland(
            {
                scope: scope({ id: input<string>() })
                    .load({ name: () => name.promise })
                    .load({ label: async ({ name }) => `[${name}]` }),
                component: ({ label }) => <div>ready {label}</div>,
                loading: Loading,
            },
            { props: { id: 'a1' } },
        );
        expect(handle.slot()).toBe('loading');

        name.resolve('env:a1');
        await flush();
        expect(handle.slot()).toBe('content');
        expect(handle.text()).toBe('ready [env:a1]');
    });

    test('a hook() load reads React context every render and feeds downstream loads', async () => {
        // The reason `env` is gone: a load reads its own deps via a hook. Here the
        // store comes from React context inside `hook(...)`, and a plain data load
        // downstream consumes the resolved value.
        const StoresContext = createContext('default');
        let calls = 0;

        const handle = await renderIsland(
            {
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
            },
            {
                props: { id: 'a1' },
                wrapper: ({ children }) => (
                    <StoresContext.Provider value="ctx">{children}</StoresContext.Provider>
                ),
            },
        );

        expect(handle.text()).toBe('hooked ctx:a1');
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
        const handle = await renderIsland(
            {
                scope: scope({ id: input<string>() }).load({
                    page: async (): Promise<string> => {
                        throw new NotAvailableError('no such page', { code: 'not-available' });
                    },
                }),
                component: () => <div>ready</div>,
                loading: Loading,
                error: ({ error }) => <div>error: {error.code}</div>,
            },
            { props: { id: 'a1' } },
        );

        expect(handle.slot()).toBe('error');
        expect(handle.text()).toBe('error: not-available');
    });

    test('renders the error slot and retries successfully', async () => {
        let failures = 1;

        const handle = await renderIsland(
            {
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
            },
            { props: { id: 'a1' } },
        );

        expect(handle.slot()).toBe('error');
        const retryButton = handle.container.querySelector('button')!;
        await act(async () => {
            retryButton.click();
        });
        await flush();

        expect(handle.slot()).toBe('content');
        expect(handle.text()).toBe('ready data:a1');
    });

    test('attaches sources and detaches them on unmount', async () => {
        const res = controllableSource<{ id: string }>();

        const handle = await renderIsland(
            {
                scope: scope({ id: input<string>() }).load({ res: () => res }),
                component: ({ res: r }) => <div>ready {r.id}</div>,
                loading: Loading,
            },
            { props: { id: 'a1' } },
        );
        expect(res.attached).toBe(true);

        await act(async () => res.setReady({ id: 'a1' }));
        expect(handle.text()).toBe('ready a1');

        handle.unmount();
        expect(res.attached).toBe(false);
    });

    test('builds a dependent level only once the prior source is ready', async () => {
        const space = controllableSource<string>();
        const page = controllableSource<{ id: string }>();

        const handle = await renderIsland(
            {
                scope: scope({ id: input<string>() })
                    .load({ space: () => space })
                    .load({ page: () => page }),
                component: ({ page: p }) => <div>ready {p.id}</div>,
                loading: Loading,
            },
            { props: { id: 'a1' } },
        );

        // The page level must not be built until `space` is ready.
        expect(space.attached).toBe(true);
        expect(page.attached).toBe(false);

        await act(async () => space.setReady('s1'));
        expect(page.attached).toBe(true);

        await act(async () => page.setReady({ id: 'p1' }));
        expect(handle.text()).toBe('ready p1');
    });

    test('resolves a source level that depends on a promise level', async () => {
        // The page route's shape: a promise (slug → spaceId) feeds a source (the doc
        // keyed by that id). The source level can't build until the promise resolves.
        const spaceId = deferred<string>();
        const buildLog: string[] = [];
        const tree = controllableSource<{ id: string }>();

        const handle = await renderIsland(
            {
                scope: scope({ id: input<string>() })
                    .load({ spaceId: () => spaceId.promise })
                    .load({
                        tree: ({ spaceId }) => {
                            buildLog.push(`build-tree:${spaceId}`);
                            return tree;
                        },
                    }),
                component: ({ tree: t }) => <div>ready {t.id}</div>,
                loading: Loading,
            },
            { props: { id: 'a1' } },
        );
        // Suspended on the promise — the source level hasn't been built yet.
        expect(handle.slot()).toBe('loading');
        expect(buildLog).not.toContain('build-tree:s1');

        spaceId.resolve('s1');
        await flush();
        // The promise resolved, so the source level builds (with the resolved id) and
        // attaches; still loading until the source itself is ready.
        expect(buildLog).toContain('build-tree:s1');
        expect(tree.attached).toBe(true);

        await act(async () => tree.setReady({ id: 'p1' }));
        expect(handle.text()).toBe('ready p1');
    });

    test('a ready source returning to pending drops back to loading', async () => {
        const res = controllableSource<{ id: string }>();

        const handle = await renderIsland(
            {
                scope: scope({ id: input<string>() }).load({ res: () => res }),
                component: ({ res: r }) => <div>ready {r.id}</div>,
                loading: Loading,
            },
            { props: { id: 'a1' } },
        );
        await act(async () => res.setReady({ id: 'a1' }));
        expect(handle.slot()).toBe('content');

        await act(async () => res.setPending());
        expect(handle.slot()).toBe('loading');
    });

    test('detaches the previous run and re-resolves when params change', async () => {
        const sources = new Map<string, ControllableSource<{ id: string }>>();
        const sourceFor = (id: string) => {
            let source = sources.get(id);
            if (!source) {
                source = controllableSource<{ id: string }>();
                sources.set(id, source);
            }
            return source;
        };

        const handle = await renderIsland(
            {
                scope: scope({ id: input<string>() }).load({ res: ({ id }) => sourceFor(id) }),
                component: ({ res }) => <div>ready {res.id}</div>,
                loading: Loading,
            },
            { props: { id: 'a1' } },
        );
        await act(async () => sourceFor('a1').setReady({ id: 'a1' }));
        expect(handle.text()).toBe('ready a1');

        await handle.rerender({ id: 'a2' });
        expect(sourceFor('a1').attached).toBe(false);

        await act(async () => sourceFor('a2').setReady({ id: 'a2' }));
        expect(handle.text()).toBe('ready a2');
    });

    test('builds the .provide() value from the resolved chain and provides it to the subtree', async () => {
        const ctxScope = scope({ id: input<string>() })
            .load({ name: async ({ id }) => `env:${id}` })
            .provide(({ name }) => ({ label: `<${name}>` }));

        function Consumer() {
            const ctx = useScope(ctxScope);
            return <div>ctx {ctx.label}</div>;
        }

        const handle = await renderIsland(
            { scope: ctxScope, component: () => <Consumer />, loading: Loading },
            { props: { id: 'a1' } },
        );
        expect(handle.text()).toBe('ctx <env:a1>');
    });

    test('disposes the context before detaching the sources it was built from', async () => {
        const log: string[] = [];
        const res = controllableSource<{ id: string }>({ onDetach: () => log.push('detach:res') });

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

        function Mounted() {
            const ctx = useScope(ctxScope);
            return <div>ctx {ctx.id}</div>;
        }

        const handle = await renderIsland(
            { scope: ctxScope, component: () => <Mounted />, loading: Loading },
            { props: { id: 'a1' } },
        );
        await act(async () => res.setReady({ id: 'a1' }));
        expect(handle.text()).toBe('ctx a1');
        expect(log).toContain('context-mount');

        handle.unmount();
        // The context teardown must run while the grab is still live — i.e. before
        // the source it was built from detaches.
        expect(log.indexOf('context-dispose')).toBeLessThan(log.indexOf('detach:res'));
    });

    test('rebuilds the context on param change, disposing the previous one first', async () => {
        const log: string[] = [];
        const sources = new Map<string, ControllableSource<{ id: string }>>();
        const sourceFor = (id: string) => {
            let source = sources.get(id);
            if (!source) {
                source = controllableSource<{ id: string }>({
                    onDetach: () => log.push(`detach:${id}`),
                });
                sources.set(id, source);
            }
            return source;
        };

        const handle = await renderIsland(
            {
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
            },
            { props: { id: 'a1' } },
        );
        await act(async () => sourceFor('a1').setReady({ id: 'a1' }));
        expect(handle.text()).toBe('ready a1');
        expect(log).toContain('context-mount:a1');

        await handle.rerender({ id: 'a2' });
        expect(log.indexOf('context-dispose:a1')).toBeLessThan(log.indexOf('detach:a1'));

        await act(async () => sourceFor('a2').setReady({ id: 'a2' }));
        expect(handle.text()).toBe('ready a2');
        expect(log).toContain('context-mount:a2');
    });

    test('.provide({ provideTo }) also publishes the value into an app-owned context', async () => {
        const AppContext = createContext<{ label: string } | null>(null);

        // Reads the value through the app context — no useScope, so an app
        // consumer never has to import the island (which would cycle).
        function Consumer() {
            const ctx = useContext(AppContext);
            return <div>app {ctx?.label}</div>;
        }

        const handle = await renderIsland(
            {
                scope: scope({ id: input<string>() }).provide(({ id }) => ({ label: `#${id}` }), {
                    provideTo: AppContext,
                }),
                component: () => <Consumer />,
                loading: Loading,
            },
            { props: { id: 'a1' } },
        );
        expect(handle.text()).toBe('app #a1');
    });

    test('useOptionalScope returns the value when a context is provided above', async () => {
        const ctxScope = scope({ id: input<string>() }).provide(({ id }) => ({ label: `#${id}` }));

        function Consumer() {
            const ctx = useOptionalScope(ctxScope);
            return <div>opt {ctx ? ctx.label : 'none'}</div>;
        }

        const handle = await renderIsland(
            { scope: ctxScope, component: () => <Consumer />, loading: Loading },
            { props: { id: 'a1' } },
        );
        expect(handle.text()).toBe('opt #a1');
    });

    test('useOptionalScope returns undefined when rendered outside the island', () => {
        const ctxScope = scope({ id: input<string>() }).provide(({ id }) => ({ label: `#${id}` }));
        // Build the island so the scope's channel exists, but render the reader with no
        // <Island> above it — a present scope with no provider in the tree. Not an island
        // mount, so renderIsland doesn't apply: a bare RTL render is the honest tool.
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

        // No `.provide()`, so the island provides its resolved props to the subtree.
        function Consumer() {
            const props = useScope(propsScope);
            return <div>props {props.id}</div>;
        }

        const handle = await renderIsland(
            { scope: propsScope, component: () => <Consumer />, loading: Loading },
            { props: { id: 'a1' } },
        );
        expect(handle.text()).toBe('props a1');
    });

    // StrictMode mounts, tears down, then remounts on the initial commit. Each
    // remount builds a *fresh* run (new sources, new context). These tests pin that
    // the subtree ends up reading the surviving run's identities — never a value
    // from the discarded first run — and that the discarded context is disposed
    // while its own source is still attached.

    // A source ready immediately, tagged with a per-build identity so run #1 and run #2
    // are distinguishable, logging attach/detach so teardown is observable.
    function readySourceFactory(log: string[]) {
        let seq = 0;
        return () => {
            const id = `src${++seq}`;
            return controllableSource({
                initial: { id },
                onAttach: () => log.push(`attach:${id}`),
                onDetach: () => log.push(`detach:${id}`),
            });
        };
    }

    // These pin StrictMode's discard-remount specifically, which needs a *synchronous* mount
    // (renderIsland mounts under an async act, and React skips the remount there — see its
    // docs). So they stay on a bare RTL render, driving the controllableSource-backed factory.

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
        const Island = island({ scope: ctxScope, component: () => <Consumer />, loading: Loading });

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
        // cross-talk. Two islands in one tree isn't a single-island mount, so this stays
        // on a bare RTL render.
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
