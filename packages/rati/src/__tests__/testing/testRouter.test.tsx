import { describe, test, expect, afterEach } from 'vite-plus/test';

import { act, createContext, useContext, type FC, type ReactNode } from 'react';

import { Link } from '../../router/Link.js';
import { route, type GenericRouteType } from '../../router/route.js';
import { createTestRouter, cleanup } from '../../testing/index.js';

afterEach(cleanup);

const HomePage: FC = () => <div>home page</div>;
const AboutPage: FC = () => <div>about page</div>;
const routes = [
    route('/', 'home', HomePage),
    route('/about', 'about', AboutPage),
] satisfies readonly GenericRouteType[];

describe('createTestRouter', () => {
    test('renders the matched route and navigates', async () => {
        const tr = await createTestRouter(routes, { url: '/' });
        expect(tr.text()).toBe('home page');
        expect(tr.router.path).toBe('/');

        await tr.navigate('/about');
        expect(tr.text()).toBe('about page');
        expect(tr.router.path).toBe('/about');
    });

    test('back() and forward() traverse the memory entry stack', async () => {
        const tr = await createTestRouter(routes, { url: '/' });
        await tr.navigate('/about');
        expect(tr.router.path).toBe('/about');

        await tr.back();
        expect(tr.router.path).toBe('/');

        await tr.forward();
        expect(tr.router.path).toBe('/about');
    });

    // The acceptance case for Jnana's two `vi.mock('rati')` files: with a real test router
    // mounted, <Link> works — no mock needed.
    test('a <Link> navigates against the test router, no mocks', async () => {
        const Nav: FC = () => (
            <div>
                home page <Link href="/about">go</Link>
            </div>
        );
        const tr = await createTestRouter([
            route('/', 'home', Nav),
            route('/about', 'about', AboutPage),
        ]);

        const anchor = tr.container.querySelector('a')!;
        expect(anchor.getAttribute('href')).toBe('/about');

        // The click alone must navigate — Link intercepts it and calls router.navigate.
        await act(async () => {
            anchor.click();
        });
        expect(tr.router.path).toBe('/about');
        expect(tr.text()).toBe('about page');
    });

    // The RF-01 dispose pin: a disposed harness detaches its history, so driving that history
    // afterwards is inert — no listener growth across sequential harnesses.
    test('dispose detaches the history (a disposed router stops reacting)', async () => {
        const tr = await createTestRouter(routes, { url: '/' });
        const { router, history } = tr;
        expect(router.path).toBe('/');

        tr.dispose();
        history.push('/about'); // the store unlistened; the memory history dropped its listeners
        expect(router.path).toBe('/');
    });
});

describe('createTestRouter — state', () => {
    test('seeds the initial entry state', async () => {
        const tr = await createTestRouter(routes, { url: '/', state: { panel: 'left' } });
        expect(tr.router.state).toEqual({ panel: 'left' });
    });
});

describe('createTestRouter — basename', () => {
    test('matches and navigates under a basename (the fuzz-harness / preload shape)', async () => {
        const tr = await createTestRouter(routes, { url: '/admin/about', basename: '/admin' });
        expect(tr.text()).toBe('about page');
        expect(tr.router.path).toBe('/about'); // route-space path, basename stripped

        await tr.navigate('/');
        expect(tr.text()).toBe('home page');
    });
});

describe('createTestRouter — wrapper', () => {
    // The seam an app's own stores/DI provider rides in on (rati has no stores container;
    // an app provides its own context and passes its provider here). It renders inside
    // the router context, so the wrapped tree can use <Link> and useRouter too.
    const AppContext = createContext<string | null>(null);
    const AppProvider: FC<{ children?: ReactNode }> = ({ children }) => (
        <AppContext.Provider value="app">{children}</AppContext.Provider>
    );
    const CtxPage: FC = () => <div>ctx {useContext(AppContext)}</div>;

    test('renders app context inside the router context', async () => {
        const tr = await createTestRouter([route('/', 'home', CtxPage)], {
            wrapper: AppProvider,
        });
        expect(tr.text()).toBe('ctx app');
    });

    test('rerender keeps both providers', async () => {
        const tr = await createTestRouter([route('/', 'home', HomePage)], {
            wrapper: AppProvider,
            ui: <CtxPage />,
        });
        expect(tr.text()).toBe('ctx app');
        await tr.rerender(<CtxPage />);
        expect(tr.text()).toBe('ctx app');
    });
});
