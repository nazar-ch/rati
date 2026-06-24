import { describe, test, expect, vi, beforeEach, afterEach } from 'vite-plus/test';
import { renderToString } from 'react-dom/server';
import { prerender } from 'react-dom/static';
import { hydrateRoot } from 'react-dom/client';
import { WebRouterStore } from '../../router/store';
import { route } from '../../router/route';
import { RootStore, RootStoreProvider } from '../../stores/RootStore';
import { Router } from '../../router/Router';
import { createBrowserHistory, createMemoryHistory } from '../../router/history';
import { prepareRoute } from '../../router/prepareRoute';
import { scope, type ScopeComponent } from '../../scope/scope';
import { createIslandHydrationCollector, IslandHydrationProvider } from '../../island/island';
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

async function ssrThenHydrate(url: string, routes: any) {
    // ----- Server -----
    const serverRouter = new WebRouterStore({}, routes, {
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

    const clientRouter = new WebRouterStore({}, routes, {
        history: createBrowserHistory(),
        hydratedState: prepared!.hydratedState,
    });
    const clientRoot = new RootStore({ router: clientRouter }, { isReady: true });

    const ClientApp = () => (
        <RootStoreProvider rootStore={clientRoot}>
            <Router />
        </RootStoreProvider>
    );

    let root: ReturnType<typeof hydrateRoot>;
    await act(async () => {
        root = hydrateRoot(container, <ClientApp />);
    });

    return {
        prepared,
        html,
        container,
        cleanup: () => {
            root.unmount();
            container.remove();
            clientRouter.dispose();
        },
    };
}

describe('SSR + hydration', () => {
    test('hydrates a static route without console errors', async () => {
        const { html, cleanup } = await ssrThenHydrate('/', baseRoutes);

        expect(html).toContain('welcome home');
        // The only call we tolerate is none — hydration mismatches and
        // useDeferredValue mistakes both surface as console.error.
        expect(consoleErrorSpy).not.toHaveBeenCalled();
        cleanup();
    });

    test('hydrates a parameterized route without console errors', async () => {
        const { html, cleanup } = await ssrThenHydrate('/users/42', baseRoutes);

        expect(html).toContain('data-testid="user"');
        expect(consoleErrorSpy).not.toHaveBeenCalled();
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
        const serverRouter = new WebRouterStore({}, routesWithScope, {
            history: createMemoryHistory({ url: '/' }),
        });
        const serverRoot = new RootStore({ router: serverRouter }, { isReady: true });
        const prepared = await prepareRoute(serverRouter);
        const collector = createIslandHydrationCollector();
        const html = await prerenderToString(
            <IslandHydrationProvider collect={collector.collect}>
                <RootStoreProvider rootStore={serverRoot}>
                    <Router />
                </RootStoreProvider>
            </IslandHydrationProvider>,
        );
        serverRouter.dispose();

        expect(html).toContain('hello from server');
        expect(calls).toBe(1);

        // ----- Client: hydrate from the routing snapshot + dehydrated island data -----
        window.history.replaceState(null, '', '/');
        const container = document.createElement('div');
        container.innerHTML = html;
        document.body.appendChild(container);

        const clientRouter = new WebRouterStore({}, routesWithScope, {
            history: createBrowserHistory(),
            hydratedState: prepared!.hydratedState,
        });
        const clientRoot = new RootStore({ router: clientRouter }, { isReady: true });

        let root: ReturnType<typeof hydrateRoot>;
        await act(async () => {
            root = hydrateRoot(
                container,
                <IslandHydrationProvider data={collector.data}>
                    <RootStoreProvider rootStore={clientRoot}>
                        <Router />
                    </RootStoreProvider>
                </IslandHydrationProvider>,
            );
        });

        // The promise was not re-run on the client and the content hydrated.
        expect(calls).toBe(1);
        expect(container.textContent).toContain('hello from server');
        // No hydration *mismatch* surfaced. We tolerate one dev-only warning: running
        // react-dom/static (server) and react-dom/client (hydrate) in a single process
        // shares the module-level store context between two renderers — impossible in
        // production, where server and browser are separate processes. A real mismatch
        // would be a different message and still fail here.
        const mismatchErrors = consoleErrorSpy.mock.calls.filter(
            (args: unknown[]) => !String(args[0]).includes('multiple renderers concurrently'),
        );
        expect(mismatchErrors).toEqual([]);

        root!.unmount();
        container.remove();
        clientRouter.dispose();
    });
});
