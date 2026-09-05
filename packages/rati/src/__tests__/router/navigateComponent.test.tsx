import { describe, test, expect, beforeEach, afterEach } from 'vite-plus/test';

import { StrictMode, type FC } from 'react';

import { act, render, screen, cleanup } from '@testing-library/react';

import { createBrowserHistory } from '../../router/history.js';
import { Navigate } from '../../router/Navigate.js';
import { route } from '../../router/route.js';
import { RouterOutlet } from '../../router/RouterOutlet.js';
import { RouterProvider } from '../../router/RouterProvider.js';
import { RouterStore } from '../../router/store.js';

const Home: FC = () => <Navigate to="/dashboard" />;
const Dashboard: FC = () => <div data-testid="dashboard">dashboard</div>;

const routes = [route('/', 'home', Home), route('/dashboard', 'dashboard', Dashboard)] as const;

beforeEach(() => {
    window.history.replaceState(null, '', 'http://localhost/');
});

afterEach(() => {
    cleanup();
});

function renderApp(router: RouterStore<any>) {
    return render(
        <StrictMode>
            <RouterProvider router={router}>
                <RouterOutlet />
            </RouterProvider>
        </StrictMode>,
    );
}

describe('<Navigate>', () => {
    test('navigates to the target route under browser history + StrictMode', async () => {
        const history = createBrowserHistory();
        const router = new RouterStore(routes, { history });
        renderApp(router);

        await act(async () => {
            await Promise.resolve();
        });

        expect(screen.getByTestId('dashboard')).toBeDefined();
        expect(window.location.pathname).toBe('/dashboard');
        expect(router.path).toBe('/dashboard');
        router.dispose();
    });
});

describe('RouterStore.setPath', () => {
    test('resolves activeRoute on a repeat call when activeRoute is still null', () => {
        // Simulate the initial-mount race: a second history event fires for the
        // same pathname before the first call has assigned activeRoute. The
        // tightened guard must not early-return when activeRoute is null.
        const router = new RouterStore(routes);
        // Constructor already ran setPath once; clear activeRoute to simulate
        // the pre-resolution state and call setPath again.
        router.activeRoute = null;
        router.setPath(router.history.location);
        expect(router.activeRoute).not.toBeNull();
        expect(router.activeRoute!.name).toBe('home');
        router.dispose();
    });
});
