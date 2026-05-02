import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderToString } from 'react-dom/server';
import { hydrateRoot } from 'react-dom/client';
import { WebRouterStore, route } from '../stores/WebRouterStore';
import { RootStore, RootStoreProvider } from '../stores/RootStore';
import { Router } from '../common/Router';
import { createBrowserHistory, createMemoryHistory } from '../common/history';
import { prepareRoute } from '../common/prepareRoute';
import { createView } from '../common/view';
import { act } from '@testing-library/react';

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

    test('captures view props in the hydrated state for routes with views', async () => {
        function Greeting(props: { greeting: string }) {
            return <div data-testid="greeting">{props.greeting}</div>;
        }
        const view = createView({
            greeting: async () => 'hello from server',
        });
        const routesWithView = [route('/', 'home', Greeting as any, view as any)] as const;

        const { html, prepared, cleanup } = await ssrThenHydrate('/', routesWithView);

        expect(html).toContain('hello from server');
        expect(prepared!.hydratedState.viewProps).toEqual({
            greeting: 'hello from server',
        });
        expect(consoleErrorSpy).not.toHaveBeenCalled();
        cleanup();
    });
});
