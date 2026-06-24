import { describe, test, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import { prerender } from 'react-dom/static';
import type { ReactElement } from 'react';
import { WebRouterStore } from '../../router/store';
import { route, type GenericRouteType } from '../../router/route';
import { RootStore, RootStoreProvider } from '../../stores/RootStore';
import { Router } from '../../router/Router';
import { createMemoryHistory } from '../../router/history';
import { prepareRoute } from '../../router/prepareRoute';
import { scope, type ScopeComponent } from '../../scope/scope';

// react-dom/static `prerender` awaits Suspense before producing HTML, so an island
// route's promise-backed scope resolves server-side (renderToString does not).
async function prerenderToString(element: ReactElement): Promise<string> {
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

function NotFound() {
    return <div data-testid="not-found">not found</div>;
}

const routes = [
    route('/', 'home', Home),
    route('/users/:userId', 'user', User),
    route('*', 'notFound', NotFound),
] as const;

function buildAppFor(url: string, routesArg: readonly GenericRouteType[] = routes) {
    const router = new WebRouterStore({}, routesArg, {
        history: createMemoryHistory({ url }),
    });
    const root = new RootStore({ router }, { isReady: true });
    const App = () => (
        <RootStoreProvider rootStore={root}>
            <Router />
        </RootStoreProvider>
    );
    return { router, root, App };
}

describe('renderToString with WebRouterStore + memory history', () => {
    test('renders the matched static route', async () => {
        const { router, App } = buildAppFor('/');
        await prepareRoute(router);

        const html = renderToString(<App />);

        expect(html).toContain('welcome home');
        router.dispose();
    });

    test('passes route params to the matched component', async () => {
        const { router, App } = buildAppFor('/users/42');
        await prepareRoute(router);

        const html = renderToString(<App />);

        expect(html).toContain('data-testid="user"');
        // React inserts <!-- --> between adjacent text fragments, so the
        // userId param appears separated from its label.
        expect(html).toContain('>42<');
        router.dispose();
    });

    test('falls through to the wildcard route when nothing else matches', async () => {
        const { router, App } = buildAppFor('/totally/not/here');
        await prepareRoute(router);

        const html = renderToString(<App />);

        expect(html).toContain('not found');
        router.dispose();
    });

    test('renders a route whose scope resolves through the island engine (SSR via prerender)', async () => {
        const greetingScope = scope().load({
            greeting: async () => 'hello from server',
        });
        const Greeting: ScopeComponent<typeof greetingScope> = ({ greeting }) => (
            <div data-testid="greeting">{greeting}</div>
        );

        const { router, App } = buildAppFor('/', [
            route('/', 'greet', Greeting, { scope: greetingScope }),
        ] as const);

        await prepareRoute(router);
        // prerender (not renderToString) awaits the scope's promise, so the resolved
        // content lands in the HTML — the route runs on the island engine.
        const html = await prerenderToString(<App />);

        expect(html).toContain('hello from server');
        router.dispose();
    });
});
