import { describe, test, expect, afterEach } from 'vite-plus/test';
import { act, Component, createContext, useContext, type ReactNode } from 'react';
import { scope, input } from '../../scope/scope';
import { NotAvailableError } from '../../scope/source';
import { island } from '../../island/island';
import { useScope } from '../../mandala/channel';
import { controllableSource, deferred, flush, renderIsland, cleanup } from '../../testing';

afterEach(cleanup);

describe('renderIsland — the canonical flow', () => {
    // The documented example: mount with a deferred load → loading slot → resolve → flush →
    // content slot. Runs here verbatim as a test (DX-02).
    test('deferred load → loading, then resolve → flush → content', async () => {
        const gate = deferred<string>();
        const handle = await renderIsland(
            {
                scope: scope({ id: input<string>() }).load({ page: () => gate.promise }),
                component: ({ page }) => <div>ready {page}</div>,
                loading: () => <div>loading…</div>,
            },
            { props: { id: 'a1' } },
        );

        expect(handle.slot()).toBe('loading');
        expect(handle.text()).toBe('loading…');

        gate.resolve('home');
        await flush();

        expect(handle.slot()).toBe('content');
        expect(handle.text()).toBe('ready home');
    });

    // The same flow driven by a controllableSource instead of a promise.
    test('a controllableSource walks loading → content', async () => {
        const feed = controllableSource<string>();
        const handle = await renderIsland({
            scope: scope().load({ feed: () => feed }),
            component: ({ feed: value }: { feed: string }) => <div>feed {value}</div>,
            loading: () => <div>loading…</div>,
        });

        expect(handle.slot()).toBe('loading');
        expect(feed.attached).toBe(true);

        await act(async () => feed.setReady('live'));
        expect(handle.slot()).toBe('content');
        expect(handle.text()).toBe('feed live');

        handle.unmount();
        expect(feed.attached).toBe(false);
    });
});

describe('renderIsland — slot readers', () => {
    test('routes a failed load to the error slot with the unified code', async () => {
        const handle = await renderIsland({
            scope: scope().load({
                page: async (): Promise<string> => {
                    throw new NotAvailableError('gone', { code: 'not-available' });
                },
            }),
            component: ({ page }: { page: string }) => <div>ready {page}</div>,
            loading: () => <div>loading…</div>,
            error: ({ error }) => <div>error {error.code}</div>,
        });

        await flush();
        expect(handle.slot()).toBe('error');
        expect(handle.text()).toBe('error not-available');
    });
});

describe('renderIsland — controls', () => {
    test('handle.controls() refreshes a load from the test side', async () => {
        let count = 0;
        const handle = await renderIsland({
            scope: scope().load({ value: async () => `v${++count}` }),
            component: ({ value }: { value: string }) => <div>{value}</div>,
            loading: () => <div>loading…</div>,
        });

        await flush();
        expect(handle.text()).toBe('v1');
        expect(handle.controls().pending).toBeInstanceOf(Set);

        await act(async () => {
            await handle.controls().refresh('value');
        });
        expect(handle.text()).toBe('v2');
    });
});

describe('renderIsland — rerender', () => {
    test('a param change re-resolves against the new input', async () => {
        const handle = await renderIsland(
            {
                scope: scope({ id: input<string>() }).load({
                    label: async ({ id }) => `L:${id}`,
                }),
                component: ({ label }) => <div>{label}</div>,
                loading: () => <div>loading…</div>,
            },
            { props: { id: 'a1' } },
        );

        await flush();
        expect(handle.text()).toBe('L:a1');

        await handle.rerender({ id: 'a2' });
        await flush();
        expect(handle.text()).toBe('L:a2');
    });
});

describe('renderIsland — wrapper and provide', () => {
    test('wrapper supplies app-level context; useScope reads the provided value', async () => {
        const AppContext = createContext('none');
        const ctxScope = scope({ id: input<string>() }).provide(({ id }) => ({ tag: `#${id}` }));

        function Reader() {
            const app = useContext(AppContext);
            const { tag } = useScope(ctxScope);
            return (
                <div>
                    {app}/{tag}
                </div>
            );
        }

        const handle = await renderIsland(
            { scope: ctxScope, component: () => <Reader />, loading: () => <div>loading…</div> },
            {
                props: { id: 'a1' },
                wrapper: ({ children }) => (
                    <AppContext.Provider value="app">{children}</AppContext.Provider>
                ),
            },
        );

        await flush();
        expect(handle.text()).toBe('app/#a1');
    });
});

describe('renderIsland — a dead island reads honestly', () => {
    class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
        override state = { failed: false };
        static getDerivedStateFromError() {
            return { failed: true };
        }
        override render() {
            return this.state.failed ? <div>caught outside</div> : this.props.children;
        }
    }

    test('slot() throws when the island threw past its slots (no error slot declared)', async () => {
        const handle = await renderIsland(
            {
                // No `error` slot: the scope error rethrows to the wrapper's boundary and the
                // island's markers unmount with it.
                scope: scope().load({
                    page: async (): Promise<string> => {
                        throw new NotAvailableError('gone');
                    },
                }),
                component: ({ page }: { page: string }) => <div>ready {page}</div>,
                loading: () => <div>loading…</div>,
            },
            { wrapper: Boundary },
        );

        await flush();
        expect(handle.container.textContent).toContain('caught outside');
        // Before the fix this read 'loading' — a silently wrong answer for a dead island.
        expect(() => handle.slot()).toThrow(/no slot marker/);
    });
});

describe('renderIsland — a pre-built island (component mode)', () => {
    test('mounts and queries via the container; slot()/controls() need config mode', async () => {
        const Island = island({
            scope: scope(),
            component: () => <div>built</div>,
            loading: () => <div>loading…</div>,
        });
        const handle = await renderIsland(Island);

        await flush();
        expect(handle.container.textContent).toContain('built');
        expect(() => handle.slot()).toThrow(/config mode/);
        expect(() => handle.controls()).toThrow(/config mode/);
    });
});

describe('renderIsland — cleanup', () => {
    test('cleanup unmounts every mounted island and removes its container', async () => {
        const handle = await renderIsland({ scope: scope(), component: () => <div>x</div> });
        await flush();
        expect(document.body.contains(handle.container)).toBe(true);

        cleanup();
        expect(document.body.contains(handle.container)).toBe(false);
    });
});
