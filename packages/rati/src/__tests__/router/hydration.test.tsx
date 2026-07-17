import { describe, test, expect, vi, beforeEach, afterEach } from 'vite-plus/test';
import { renderToString } from 'react-dom/server';
import { prerender } from 'react-dom/static';
import { hydrateRoot } from 'react-dom/client';
import { RouterStore } from '../../router/store';
import { route } from '../../router/route';
import { RootStore, RootStoreProvider } from '../../stores/RootStore';
import { Router } from '../../router/Router';
import { createBrowserHistory, createMemoryHistory } from '../../router/history';
import { prepareRoute } from '../../router/prepareRoute';
import { scope, type ScopeComponent } from '../../scope/scope';
import { createHydrationCollector, HydrationProvider } from '../../mandala/hydration';
import { act } from '@testing-library/react';

async function prerenderToString(element: React.ReactElement): Promise<string> {
    const { prelude } = await prerender(element);
    const reader = prelude.getReader();
    const decoder = new TextDecoder();
    let html = '';
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        html += decoder.decode(value, { stream: true });
    }
    return html;
}

function Home() {
    return <div data-testid="home">welcome home</div>;
}

function User(props: { userId: string }) {
    return <div data-testid="user">user {props.userId}</div>;
}

const baseRoutes = [route('/', 'home', Home), route('/users/:userId', 'user', User)] as const;

let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
    window.history.replaceState(null, '', 'http://localhost/');
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
    consoleErrorSpy.mockRestore();
});

/**
 * The console.error calls React meant. One message is tolerated: running
 * react-dom/server and react-dom/client in a single process shares the module-level
 * store context between two renderers, which cannot happen where the server and the
 * browser are separate processes.
 *
 * This is the weaker of the two checks each mount below makes, and deliberately not the
 * only one — see `recovered` at every hydrate: a mismatch React client-renders through
 * is reported to `onRecoverableError`, not here.
 */
function reactErrors(calls: unknown[][]): unknown[][] {
    return calls.filter((args) => !String(args[0]).includes('multiple renderers concurrently'));
}

async function ssrThenHydrate(url: string, routes: any) {
    // ----- Server -----
    const serverRouter = new RouterStore({}, routes, {
        history: createMemoryHistory({ url }),
    });
    const serverRoot = new RootStore({ router: serverRouter }, { isReady: true });
    const prepared = await prepareRoute(serverRouter);

    const ServerApp = () => (
        <RootStoreProvider rootStore={serverRoot}>
            <Router />
        </RootStoreProvider>
    );
    const html = renderToString(<ServerApp />);
    serverRouter.dispose();

    // ----- Client -----
    window.history.replaceState(null, '', url);
    const container = document.createElement('div');
    container.innerHTML = html;
    document.body.appendChild(container);

    const clientRouter = new RouterStore({}, routes, {
        history: createBrowserHistory(),
        hydratedState: prepared!.hydratedState,
    });
    const clientRoot = new RootStore({ router: clientRouter }, { isReady: true });

    const ClientApp = () => (
        <RootStoreProvider rootStore={clientRoot}>
            <Router />
        </RootStoreProvider>
    );

    // The mismatch channel. React reports a mismatch it recovered from (by
    // client-rendering the boundary) to `onRecoverableError`, whose default is
    // `reportGlobalError` — *not* console.error. Under Vitest that default lands as an
    // "Unhandled Error" the reporter prints and no assertion reads, so the console spy
    // below cannot see a mismatch at all. Every test here asserts on this instead.
    const recovered = vi.fn();

    let root: ReturnType<typeof hydrateRoot>;
    await act(async () => {
        root = hydrateRoot(container, <ClientApp />, { onRecoverableError: recovered });
    });

    return {
        prepared,
        html,
        container,
        recovered,
        cleanup: () => {
            root.unmount();
            container.remove();
            clientRouter.dispose();
        },
    };
}

describe('SSR + hydration', () => {
    test('hydrates a static route with no mismatch', async () => {
        const { html, recovered, cleanup } = await ssrThenHydrate('/', baseRoutes);

        expect(html).toContain('welcome home');
        // The server's markup was hydrated as-is: React neither recovered from a
        // mismatch nor said anything of its own.
        expect(recovered).not.toHaveBeenCalled();
        expect(reactErrors(consoleErrorSpy.mock.calls)).toEqual([]);
        cleanup();
    });

    test('hydrates a parameterized route with no mismatch', async () => {
        const { html, recovered, cleanup } = await ssrThenHydrate('/users/42', baseRoutes);

        expect(html).toContain('data-testid="user"');
        expect(recovered).not.toHaveBeenCalled();
        expect(reactErrors(consoleErrorSpy.mock.calls)).toEqual([]);
        cleanup();
    });

    test('hydrates a scope route from dehydrated island data without re-running its promise', async () => {
        let calls = 0;
        const greetingScope = scope().load({
            greeting: async () => {
                calls++;
                return 'hello from server';
            },
        });
        const Greeting: ScopeComponent<typeof greetingScope> = ({ greeting }) => (
            <div data-testid="greeting">{greeting}</div>
        );
        const routesWithScope = [route('/', 'home', Greeting, { scope: greetingScope })] as const;

        // ----- Server: prerender (awaits the promise) + collect its resolved value -----
        const serverRouter = new RouterStore({}, routesWithScope, {
            history: createMemoryHistory({ url: '/' }),
        });
        const serverRoot = new RootStore({ router: serverRouter }, { isReady: true });
        const prepared = await prepareRoute(serverRouter);
        const collector = createHydrationCollector();
        const html = await prerenderToString(
            <HydrationProvider collect={collector.collect}>
                <RootStoreProvider rootStore={serverRoot}>
                    <Router />
                </RootStoreProvider>
            </HydrationProvider>,
        );
        serverRouter.dispose();

        expect(html).toContain('hello from server');
        expect(calls).toBe(1);

        // ----- Client: hydrate from the routing snapshot + dehydrated island data -----
        window.history.replaceState(null, '', '/');
        const container = document.createElement('div');
        container.innerHTML = html;
        document.body.appendChild(container);

        const clientRouter = new RouterStore({}, routesWithScope, {
            history: createBrowserHistory(),
            hydratedState: prepared!.hydratedState,
        });
        const clientRoot = new RootStore({ router: clientRouter }, { isReady: true });

        const recovered = vi.fn();
        let root: ReturnType<typeof hydrateRoot>;
        await act(async () => {
            root = hydrateRoot(
                container,
                <HydrationProvider data={collector.data}>
                    <RootStoreProvider rootStore={clientRoot}>
                        <Router />
                    </RootStoreProvider>
                </HydrationProvider>,
                { onRecoverableError: recovered },
            );
        });

        // The promise was not re-run on the client and the content hydrated.
        expect(calls).toBe(1);
        expect(container.textContent).toContain('hello from server');
        // No hydration mismatch: the dehydrated value rendered the same markup the
        // server shipped, so React had nothing to recover from.
        expect(recovered).not.toHaveBeenCalled();
        expect(reactErrors(consoleErrorSpy.mock.calls)).toEqual([]);

        root!.unmount();
        container.remove();
        clientRouter.dispose();
    });
});
