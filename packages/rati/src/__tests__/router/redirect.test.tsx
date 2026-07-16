import { describe, test, expect, vi, afterEach } from 'vite-plus/test';
import { cleanup, render } from '@testing-library/react';
import { route } from '../../router/route';
import { RouterStore } from '../../router/store';
import { createMemoryHistory } from '../../router/history';
import { prepareRoute } from '../../router/prepareRoute';
import { Router } from '../../router/Router';
import { RootStore, RootStoreProvider } from '../../stores/RootStore';
import type { GenericRouteType } from '../../router/route';

afterEach(cleanup);

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

    test('hydrating onto a redirect route replays it as-is — no follow', () => {
        // Reachable only from a server that ignored `renderApp`'s redirect result and
        // built a snapshot naming the redirect route itself (the normal flow names the
        // *target*, per prepareRoute). Pinning the choice rather than the accident:
        // seeding is a verbatim replay of the server's decision, not a re-derivation —
        // following the hop here would move the URL out from under the server's HTML
        // and guarantee a mismatch. So the route renders as written, which for a
        // redirect route means its (empty) component. The server is the thing at fault.
        const router = new RouterStore({}, makeRoutes(), {
            history: createMemoryHistory({ url: '/settings' }),
            hydratedState: {
                path: '/settings',
                search: '',
                hash: '',
                activeRouteName: 'settings',
                routeParams: {},
            },
        });
        const root = new RootStore({ router }, { isReady: true });

        const view = render(
            <RootStoreProvider rootStore={root}>
                <Router />
            </RootStoreProvider>,
        );

        expect(router.activeRoute?.name).toBe('settings');
        expect(router.path).toBe('/settings');
        expect(router.redirectHops).toEqual([]);
        // The declaration rides along on the active route — nothing acts on it.
        expect(router.activeRoute?.redirect).toBeDefined();
        expect(view.container.innerHTML).toBe('');

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

    test('a route redirecting to itself is a cycle of length one', () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        const Self = () => <div>self</div>;
        const routes = [
            route('/home', 'home', Home),
            route('/self', 'self', Self, { redirect: { to: '/self' } }),
            route('*', 'notFound', NotFound),
        ] as const satisfies GenericRouteType[];
        const router = new RouterStore({}, routes, {
            history: createMemoryHistory({ url: '/home' }),
        });

        router.navigate('/self');

        // Entering from another route is load-bearing, and it is what made this the one
        // shape that produced a genuinely stale route: the same-path early return needs a
        // resolved `activeRoute` to skip past, so a router constructed straight at /self
        // never had the bug — it recursed to the depth cap like any other cycle. With the
        // self-check reverted this reads 'home' (executed once): the previous page, left
        // on screen at the new URL.
        expect(router.activeRoute?.name).toBe('self');
        expect(router.path).toBe('/self');
        expect(router.history.location.pathname).toBe('/self');
        // One hop — the one it refused to follow — rather than the ten identical ones a
        // cycle of length one would otherwise record on its way to the cap.
        expect(router.redirectHops).toEqual([{ from: '/self', to: '/self', permanent: false }]);
        expect(error.mock.calls[0]![0]).toContain('redirect loop');

        error.mockRestore();
        router.dispose();
    });

    test('a self-redirect differing only in query is the same cycle', () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        const Self = () => <div>self</div>;
        const routes = [
            route('/home', 'home', Home),
            route('/self', 'self', Self, { redirect: { to: '/self?tab=a' } }),
            route('*', 'notFound', NotFound),
        ] as const satisfies GenericRouteType[];
        const router = new RouterStore({}, routes, {
            history: createMemoryHistory({ url: '/home' }),
        });

        router.navigate('/self');

        // The cycle check compares pathnames alone. A target that re-enters its own route
        // carrying a query is still a target that cannot resolve to anything else — the
        // query rides along into the same early return — so it is reported, not followed.
        expect(router.activeRoute?.name).toBe('self');
        expect(router.history.location.search).toBe('');
        expect(router.redirectHops).toEqual([
            { from: '/self', to: '/self?tab=a', permanent: false },
        ]);
        expect(error.mock.calls[0]![0]).toContain('redirect loop');

        error.mockRestore();
        router.dispose();
    });
});
