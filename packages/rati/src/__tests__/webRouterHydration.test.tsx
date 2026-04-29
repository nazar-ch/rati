import { describe, test, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { WebRouterStore, route, WebRouterHydratedState } from '../stores/WebRouterStore';
import { createMemoryHistory } from '../common/history';
import { ViewLoader } from '../common/ViewLoader';
import { createView } from '../common/view';

const NoopComponent = () => null;
const HomeComponent = () => <div>home</div>;
const UserComponent = (props: { userId: string }) => <div>user {props.userId}</div>;

const baseRoutes = [
    route('/', 'home', HomeComponent),
    route('/users/:userId', 'user', UserComponent),
    route('*', 'notFound', NoopComponent),
] as const;

describe('WebRouterStore with hydratedState', () => {
    test('seeds path/search/hash synchronously', () => {
        const hydratedState: WebRouterHydratedState = {
            path: '/users/42',
            search: '?tab=posts',
            hash: '#bio',
            activeRouteName: 'user',
            routeParams: { userId: '42' },
        };
        const router = new WebRouterStore({}, baseRoutes, {
            history: createMemoryHistory({ url: '/users/42?tab=posts#bio' }),
            hydratedState,
        });

        // No await: activeRoute and the path observables are populated by the
        // constructor, not by an async setPath microtask.
        expect(router.path).toBe('/users/42');
        expect(router.search).toBe('?tab=posts');
        expect(router.hash).toBe('#bio');
        expect(router.activeRoute?.name).toBe('user');
        expect(router.activeRoute?.routeParams).toEqual({ userId: '42' });
        router.dispose();
    });

    test('populates activeRoute with the route definition', () => {
        const router = new WebRouterStore({}, baseRoutes, {
            history: createMemoryHistory({ url: '/' }),
            hydratedState: {
                path: '/',
                search: '',
                hash: '',
                activeRouteName: 'home',
                routeParams: {},
            },
        });
        expect(router.activeRoute?.component).toBe(HomeComponent);
        expect(router.activeRoute?.path).toBe('/');
        router.dispose();
    });

    test('exposes viewProps from hydration on activeRoute.hydratedViewProps', () => {
        const router = new WebRouterStore({}, baseRoutes, {
            history: createMemoryHistory({ url: '/users/42' }),
            hydratedState: {
                path: '/users/42',
                search: '',
                hash: '',
                activeRouteName: 'user',
                routeParams: { userId: '42' },
                viewProps: { user: { id: '42', name: 'Ada' } },
            },
        });
        expect(router.activeRoute?.hydratedViewProps).toEqual({
            user: { id: '42', name: 'Ada' },
        });
        router.dispose();
    });

    test('falls back to URL matching when activeRouteName is unknown', async () => {
        // Server and client routes drifted: hydrated name doesn't exist here.
        const router = new WebRouterStore({}, baseRoutes, {
            history: createMemoryHistory({ url: '/users/42' }),
            hydratedState: {
                path: '/users/42',
                search: '',
                hash: '',
                activeRouteName: 'this-route-does-not-exist',
                routeParams: {},
            },
        });
        await Promise.resolve();
        expect(router.activeRoute?.name).toBe('user');
        expect(router.activeRoute?.routeParams).toEqual({ userId: '42' });
        router.dispose();
    });

    test('subsequent navigations clear hydratedViewProps', async () => {
        const history = createMemoryHistory({ url: '/users/42' });
        const router = new WebRouterStore({}, baseRoutes, {
            history,
            hydratedState: {
                path: '/users/42',
                search: '',
                hash: '',
                activeRouteName: 'user',
                routeParams: { userId: '42' },
                viewProps: { initial: true },
            },
        });
        expect(router.activeRoute?.hydratedViewProps).toEqual({ initial: true });

        history.push('/');
        await Promise.resolve();

        expect(router.activeRoute?.name).toBe('home');
        expect(router.activeRoute?.hydratedViewProps).toBeUndefined();
        router.dispose();
    });
});

describe('ViewLoader with initialViewProps', () => {
    const view = createView({});

    function PassthroughComponent(props: any) {
        return <div data-testid="content">{JSON.stringify(props)}</div>;
    }

    function Loading() {
        return <div data-testid="loading">loading</div>;
    }

    test('renders the component immediately when initialViewProps is provided', () => {
        render(
            <ViewLoader
                Component={PassthroughComponent as any}
                view={view as any}
                params={{} as any}
                Loading={Loading}
                initialViewProps={{ greeting: 'hello from server' }}
            />
        );
        expect(screen.queryByTestId('loading')).toBeNull();
        expect(screen.getByTestId('content').textContent).toContain('hello from server');
    });

    test('falls back to async resolution when initialViewProps is omitted', () => {
        render(
            <ViewLoader
                Component={PassthroughComponent as any}
                view={view as any}
                params={{} as any}
                Loading={Loading}
            />
        );
        // First synchronous render shows Loading because resolveView is async.
        expect(screen.queryByTestId('loading')).not.toBeNull();
    });
});
