import { describe, test, expect, vi } from 'vite-plus/test';
import { route } from '../../router/route';
import { RouterStore } from '../../router/store';
import { createMemoryHistory } from '../../router/history';
import { prepareRoute } from '../../router/prepareRoute';
import type { GenericRouteType } from '../../router/route';

const Home = () => <div>home</div>;
const Settings = () => <div>settings</div>;
const NotFound = () => <div>404</div>;
const Null = () => null;

function makeRoutes() {
    return [
        route('/', 'home', Home),
        route('/settings/profile', 'settings-profile', Settings),
        // Alias kept for old links: object target, resolved through the table.
        route('/settings', 'settings', Null, {
            redirect: { to: { name: 'settings-profile' }, permanent: true },
        }),
        // Legacy param path: function target mapping the matched params.
        route('/old-profile/:userId', 'old-profile', Null, {
            redirect: { to: ({ userId }) => `/users/${userId}` },
        }),
        route('/users/:userId', 'user', ({ userId }: { userId: string }) => <div>{userId}</div>),
        route('*', 'notFound', NotFound),
    ] as const satisfies GenericRouteType[];
}

function makeRouter(url: string) {
    return new RouterStore({}, makeRoutes(), { history: createMemoryHistory({ url }) });
}

describe('route-level redirects', () => {
    test('server: prepareRoute reports the redirect and the target state', async () => {
        const router = makeRouter('/settings');
        const prepared = await prepareRoute(router);

        expect(prepared).not.toBeNull();
        expect(prepared!.redirect).toEqual({ to: '/settings/profile', permanent: true });
        // The router followed the hop, so the snapshot describes the target.
        expect(prepared!.hydratedState.activeRouteName).toBe('settings-profile');
        expect(prepared!.matchedCatchAll).toBe(false);
        router.dispose();
    });

    test('server: function target maps params; non-permanent by default', async () => {
        const router = makeRouter('/old-profile/42');
        const prepared = await prepareRoute(router);

        expect(prepared!.redirect).toEqual({ to: '/users/42', permanent: false });
        expect(prepared!.hydratedState.activeRouteName).toBe('user');
        expect(prepared!.hydratedState.routeParams).toEqual({ userId: '42' });
        router.dispose();
    });

    test('server: object target keeps the current search and hash', async () => {
        const router = makeRouter('/settings?tab=privacy#top');
        const prepared = await prepareRoute(router);
        expect(prepared!.redirect!.to).toBe('/settings/profile?tab=privacy#top');
        router.dispose();
    });

    test('server: a plain match reports no redirect; catch-all is flagged', async () => {
        const plain = await prepareRoute(makeRouter('/'));
        expect(plain!.redirect).toBeUndefined();
        expect(plain!.matchedCatchAll).toBe(false);

        const missed = await prepareRoute(makeRouter('/nope'));
        expect(missed!.matchedCatchAll).toBe(true);
        expect(missed!.hydratedState.activeRouteName).toBe('notFound');
    });

    test('client: navigating to a redirect route lands on the target synchronously', () => {
        const router = makeRouter('/');
        router.navigate('/settings');

        expect(router.activeRoute?.name).toBe('settings-profile');
        expect(router.path).toBe('/settings/profile');
        expect(router.history.location.pathname).toBe('/settings/profile');
        expect(router.redirectHops).toEqual([
            { from: '/settings', to: '/settings/profile', permanent: true },
        ]);
        router.dispose();
    });

    test('client: a new navigation clears the previous redirect trail', () => {
        const router = makeRouter('/settings');
        expect(router.redirectHops).toHaveLength(1);

        router.navigate('/');
        expect(router.redirectHops).toHaveLength(0);
        router.dispose();
    });

    test('a redirect cycle stops at the depth guard and renders instead', () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        const routes = [
            route('/a', 'a', Null, { redirect: { to: '/b' } }),
            route('/b', 'b', Null, { redirect: { to: '/a' } }),
            route('*', 'notFound', NotFound),
        ] as const satisfies GenericRouteType[];
        const router = new RouterStore({}, routes, {
            history: createMemoryHistory({ url: '/a' }),
        });

        // Following stopped: one of the cycle's routes is active, rendered as-is.
        expect(['a', 'b']).toContain(router.activeRoute?.name);
        expect(error).toHaveBeenCalled();
        expect(error.mock.calls[0]![0]).toContain('redirect loop');
        error.mockRestore();
        router.dispose();
    });
});
