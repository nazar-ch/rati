import { describe, test, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import { WebRouterStore, route } from '../stores/WebRouterStore';
import { RootStore, RootStoreProvider } from '../stores/RootStore';
import { Router } from '../common/Router';
import { createMemoryHistory } from '../common/history';
import { prepareRoute } from '../common/prepareRoute';
import { createView } from '../common/view';

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

function buildAppFor(url: string) {
    const router = new WebRouterStore({}, routes, {
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

    test('renders a route with a view, using props resolved by prepareRoute', async () => {
        function Greeting(props: { greeting: string }) {
            return <div data-testid="greeting">{props.greeting}</div>;
        }
        const view = createView({
            greeting: async () => 'hello from server',
        });
        const router = new WebRouterStore(
            {},
            [route('/', 'home', Greeting as any, view as any)] as const,
            { history: createMemoryHistory({ url: '/' }) }
        );
        const root = new RootStore({ router }, { isReady: true });

        await prepareRoute(router);

        const html = renderToString(
            <RootStoreProvider rootStore={root}>
                <Router />
            </RootStoreProvider>
        );

        expect(html).toContain('hello from server');
        router.dispose();
    });
});
