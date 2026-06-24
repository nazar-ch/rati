import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { StrictMode, type FC } from 'react';
import { act, render, screen, cleanup } from '@testing-library/react';
import { WebRouterStore } from '../router/store';
import { route } from '../router/route';
import { Router } from '../router/Router';
import { Navigate } from '../router/Navigate';
import { GenericStoresContext } from '../stores/RootStore';
import { createBrowserHistory } from '../common/history';

const Home: FC = () => <Navigate to="/dashboard" />;
const Dashboard: FC = () => <div data-testid="dashboard">dashboard</div>;

const routes = [route('/', 'home', Home), route('/dashboard', 'dashboard', Dashboard)] as const;

beforeEach(() => {
    window.history.replaceState(null, '', 'http://localhost/');
});

afterEach(() => {
    cleanup();
});

function renderApp(router: WebRouterStore<any>) {
    return render(
        <StrictMode>
            <GenericStoresContext.Provider value={{ router }}>
                <Router />
            </GenericStoresContext.Provider>
        </StrictMode>
    );
}

describe('<Navigate>', () => {
    test('navigates to the target route under browser history + StrictMode', async () => {
        const history = createBrowserHistory();
        const router = new WebRouterStore({}, routes, { history });
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

describe('WebRouterStore.setPath', () => {
    test('resolves activeRoute on a repeat call when activeRoute is still null', () => {
        // Simulate the initial-mount race: a second history event fires for the
        // same pathname before the first call has assigned activeRoute. The
        // tightened guard must not early-return when activeRoute is null.
        const router = new WebRouterStore({}, routes);
        // Constructor already ran setPath once; clear activeRoute to simulate
        // the pre-resolution state and call setPath again.
        router.activeRoute = null;
        router.setPath(router.history.location);
        expect(router.activeRoute).not.toBeNull();
        expect(router.activeRoute!.name).toBe('home');
        router.dispose();
    });
});
