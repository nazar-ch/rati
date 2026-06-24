import { describe, test, expect } from 'vitest';
import { WebRouterStore, WebRouterHydratedState } from '../router/store';
import { route } from '../router/route';
import { createMemoryHistory } from '../router/history';

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

    test('re-resolves activeRoute on a subsequent navigation', async () => {
        const history = createMemoryHistory({ url: '/users/42' });
        const router = new WebRouterStore({}, baseRoutes, {
            history,
            hydratedState: {
                path: '/users/42',
                search: '',
                hash: '',
                activeRouteName: 'user',
                routeParams: { userId: '42' },
            },
        });
        expect(router.activeRoute?.name).toBe('user');

        history.push('/');
        await Promise.resolve();

        expect(router.activeRoute?.name).toBe('home');
        router.dispose();
    });
});
