import { describe, test, expect, vi } from 'vitest';
import { WebRouterStore } from '../router/store';
import { route } from '../router/route';
import { createMemoryHistory } from '../common/history';
import { prepareRoute } from '../router/prepareRoute';
import { lazy } from '../common/lazy';

const NoopComponent = () => null;
const HomeComponent = () => <div>home</div>;
const UserComponent = (props: any) => <div>user {props.userId}</div>;

describe('prepareRoute', () => {
    test('returns a hydrated state snapshot for a static route', async () => {
        const router = new WebRouterStore({}, [route('/', 'home', HomeComponent)] as const, {
            history: createMemoryHistory({ url: '/' }),
        });

        const prepared = await prepareRoute(router);

        expect(prepared).not.toBeNull();
        expect(prepared!.hydratedState).toEqual({
            path: '/',
            search: '',
            hash: '',
            activeRouteName: 'home',
            routeParams: {},
        });
        router.dispose();
    });

    test('captures route params for parameterized routes', async () => {
        const router = new WebRouterStore(
            {},
            [route('/users/:userId', 'user', UserComponent)] as const,
            {
                history: createMemoryHistory({ url: '/users/42?tab=posts#bio' }),
            }
        );

        const prepared = await prepareRoute(router);

        expect(prepared!.hydratedState.routeParams).toEqual({ userId: '42' });
        expect(prepared!.hydratedState.path).toBe('/users/42');
        expect(prepared!.hydratedState.search).toBe('?tab=posts');
        expect(prepared!.hydratedState.hash).toBe('#bio');
        router.dispose();
    });

    test('returns null when no route matches and there is no wildcard', async () => {
        const router = new WebRouterStore({}, [route('/', 'home', HomeComponent)] as const, {
            history: createMemoryHistory({ url: '/no/such/route' }),
        });

        const prepared = await prepareRoute(router);

        expect(prepared).toBeNull();
        router.dispose();
    });

    test('falls through to a wildcard route when nothing else matches', async () => {
        const router = new WebRouterStore(
            {},
            [route('/', 'home', HomeComponent), route('*', 'notFound', NoopComponent)] as const,
            {
                history: createMemoryHistory({ url: '/missing' }),
            }
        );

        const prepared = await prepareRoute(router);

        expect(prepared!.hydratedState.activeRouteName).toBe('notFound');
        router.dispose();
    });

    test('preloads lazy components before returning', async () => {
        const factory = vi.fn(async () => ({ default: HomeComponent }));
        const LazyComponent = lazy(factory);

        const router = new WebRouterStore({}, [route('/', 'home', LazyComponent as any)] as const, {
            history: createMemoryHistory({ url: '/' }),
        });

        await prepareRoute(router);

        expect(factory).toHaveBeenCalled();
        router.dispose();
    });

    // Scope *data* resolution + SSR dehydration is the island engine's job now
    // (prepareRoute only builds the routing snapshot) — covered by islandSsr.test.tsx
    // and the router-level case in ssrRender.test.tsx.
});
