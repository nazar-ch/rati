import { describe, test, expect } from 'vite-plus/test';
import { renderToString } from 'react-dom/server';
import { RouterStore } from '../../router/store';
import { route, type GenericRouteType } from '../../router/route';
import { RootStore, RootStoreProvider } from '../../stores/RootStore';
import { Router } from '../../router/Router';
import { createMemoryHistory } from '../../router/history';
import { prepareRoute } from '../../router/prepareRoute';
import { scope, type ScopeComponent } from '../../scope/scope';
// The island route below resolves its scope through `react-dom/static` `prerender`
// (renderToString, which the contrast tests use, does not await Suspense) — the drain loop
// is now rati/testing's `prerenderToString`.
import { prerenderToString } from '../../testing';

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
    const router = new RouterStore({}, routesArg, {
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

describe('renderToString with RouterStore + memory history', () => {
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

    test('a route with ssr: false ships its loading slot and never runs the load', async () => {
        let runs = 0;
        const greetingScope = scope().load({
            greeting: async () => {
                runs++;
                return 'hello from server';
            },
        });
        const Greeting: ScopeComponent<typeof greetingScope> = ({ greeting }) => (
            <div data-testid="greeting">{greeting}</div>
        );

        const { router, App } = buildAppFor('/', [
            route('/', 'greet', Greeting, {
                scope: greetingScope,
                loading: () => <div data-testid="greet-loading">loading route</div>,
                ssr: false,
            }),
        ] as const);

        await prepareRoute(router);
        const html = await prerenderToString(<App />);

        expect(html).toContain('loading route');
        expect(html).not.toContain('hello from server');
        // The option's whole point at the route level: this page didn't wait for the load.
        expect(runs).toBe(0);
        router.dispose();
    });
});
