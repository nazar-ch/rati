import { describe, test, expect, vi, afterEach } from 'vite-plus/test';

import { createMemoryHistory } from '../../router/history.js';
import { prepareRoute } from '../../router/prepareRoute.js';
import { route } from '../../router/route.js';
import type { GenericRouteType } from '../../router/route.js';
import { RouterStore } from '../../router/store.js';
import { createTestRouter, cleanup } from '../../testing/index.js';

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
    return new RouterStore(makeRoutes(), { history: createMemoryHistory({ url }) });
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

    test('hydrating onto a redirect route replays it as-is — no follow', async () => {
        // Reachable only from a server that ignored `renderApp`'s redirect and snapshotted
        // the redirect route itself. Seeding replays the server's decision verbatim — following
        // the hop moves the URL from under the server's HTML — so the route renders its empty
        // component.
        const tr = await createTestRouter(makeRoutes(), {
            url: '/settings',
            hydratedState: {
                path: '/settings',
                search: '',
                hash: '',
                activeRouteName: 'settings',
                routeParams: {},
            },
        });

        expect(tr.router.activeRoute?.name).toBe('settings');
        expect(tr.router.path).toBe('/settings');
        expect(tr.router.redirectHops).toEqual([]);
        // The declaration rides along on the active route — nothing acts on it.
        expect(tr.router.activeRoute?.redirect).toBeDefined();
        expect(tr.container.innerHTML).toBe('');
    });

    test('a redirect cycle stops at the depth guard and renders instead', async () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        const A = () => <div>a</div>;
        const B = () => <div>b</div>;
        const routes = [
            route('/a', 'a', A, { redirect: { to: '/b' } }),
            route('/b', 'b', B, { redirect: { to: '/a' } }),
            route('*', 'notFound', NotFound),
        ] as const satisfies GenericRouteType[];
        const tr = await createTestRouter(routes, { url: '/a' });

        // Following stopped: one of the cycle's routes is active, rendered as-is.
        // WHICH one is the parity of the cap and deliberately not pinned — the fuzz
        // property makes the same call (see routerAsserts' capped-cycle oneOf).
        expect(['a', 'b']).toContain(tr.router.activeRoute?.name);
        // The route's own component reaches the DOM — not the catch-all, not a blank screen.
        // Kill: a Router declining to render a route still carrying a `redirect` → the
        // store's answer stays right and the screen goes empty.
        expect(['a', 'b']).toContain(tr.container.textContent);
        // The cap, stated where it is observable: one hop per level the guard allowed
        // and no eleventh. Kill: move MAX_REDIRECT_DEPTH — the trail's length follows it.
        expect(tr.router.redirectHops).toHaveLength(10);
        expect(tr.router.redirectHops[0]).toEqual({ from: '/a', to: '/b', permanent: false });
        expect(error).toHaveBeenCalledOnce();
        expect(error.mock.calls[0]![0]).toContain('redirect loop');
        // The trail in the report is the only place naming the routes the cycle ran through.
        // Kill: drop the hops join from the message.
        expect(error.mock.calls[0]![0]).toContain('/a → /b → /a');
        error.mockRestore();
    });

    test('a route redirecting to itself is a cycle of length one', () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        const Self = () => <div>self</div>;
        const routes = [
            route('/home', 'home', Home),
            route('/self', 'self', Self, { redirect: { to: '/self' } }),
            route('*', 'notFound', NotFound),
        ] as const satisfies GenericRouteType[];
        const router = new RouterStore(routes, {
            history: createMemoryHistory({ url: '/home' }),
        });

        router.navigate('/self');

        // Entering from another route is load-bearing: the same-path early return needs a
        // resolved `activeRoute` to skip past. Kill: revert the self-check → this reads 'home',
        // the previous page at the new URL.
        expect(router.activeRoute?.name).toBe('self');
        expect(router.path).toBe('/self');
        expect(router.history.location.pathname).toBe('/self');
        // One hop — the one it refused to follow — rather than identical ones up to the cap.
        expect(router.redirectHops).toEqual([{ from: '/self', to: '/self', permanent: false }]);
        expect(error.mock.calls[0]![0]).toContain('redirect loop');

        error.mockRestore();
        router.dispose();
    });

    test('constructed straight at a self-redirect, the cycle still ends at one hop', () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        const Self = () => <div>self</div>;
        const routes = [
            route('/home', 'home', Home),
            route('/self', 'self', Self, { redirect: { to: '/self' } }),
            route('*', 'notFound', NotFound),
        ] as const satisfies GenericRouteType[];
        const router = new RouterStore(routes, {
            history: createMemoryHistory({ url: '/self' }),
        });

        // The other way into setPath: no resolved route for the early return to skip, so
        // without the self-check this entry recurses to the depth cap. The check unifies both
        // entries at one hop.
        expect(router.activeRoute?.name).toBe('self');
        expect(router.path).toBe('/self');
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
        const router = new RouterStore(routes, {
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

    /**
     * long:2
     * A relative target is refused where the redirect is followed — else a RELATIVE
     * self-target walks past the loop check, which compares resolutions (`'self' !== '/self'`).
     *
     * Kill: drop both guards → one hop recorded, NO LOOP REPORTED, `home` on screen at `/self`;
     * both pins go red. Dropping ONLY the redirect branch's guard is the sharper kill: the
     * nested `replace` still throws, but names `[rati] replace:` rather than the declaring
     * route and records the hop first. The function-redirect pin is regression cover only.
     */
    test('a relative redirect target is refused rather than resolved', () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        const Self = () => <div>self</div>;
        const routes = [
            route('/home', 'home', Home),
            route('/self', 'self', Self, { redirect: { to: 'self' } }),
            route('*', 'notFound', NotFound),
        ] as const satisfies GenericRouteType[];
        const router = new RouterStore(routes, {
            history: createMemoryHistory({ url: '/home' }),
        });

        // The error names the route that declared the target, not just the string.
        expect(() => router.navigate('/self')).toThrow(
            /redirect from route "self": "self" is not an absolute path/,
        );
        // Refused before the hop was recorded, so nothing reports it as a followed one.
        expect(router.redirectHops).toEqual([]);
        expect(error).not.toHaveBeenCalled();

        error.mockRestore();
        router.dispose();
    });

    test('a relative target from a function redirect is refused too', () => {
        const routes = [
            route('/home', 'home', Home),
            route('/old/:userId', 'old', Null, { redirect: { to: ({ userId }) => userId } }),
            route('*', 'notFound', NotFound),
        ] as const satisfies GenericRouteType[];
        const router = new RouterStore(routes, {
            history: createMemoryHistory({ url: '/home' }),
        });

        // The function's RETURN is the target — the string rule reads it there, so a
        // legacy mapper that forgets the leading slash is caught rather than followed.
        expect(() => router.navigate('/old/7')).toThrow(/not an absolute path/);
        router.dispose();
    });

    /**
     * The open-redirect shape the origin check exists for: `%2F` decodes to `/`, so a mapper
     * can compose `//evil.com`, which passes the absolute-path check and rides `prepareRoute`
     * into the `Location` header. Refused before the hop is recorded; the kill is
     * webRouterCore.test.ts's.
     */
    test('a redirect target carrying an authority is refused, not followed', () => {
        const routes = [
            route('/home', 'home', Home),
            route('/go/:dest', 'go', Null, { redirect: { to: ({ dest }) => dest } }),
            route('*', 'notFound', NotFound),
        ] as const satisfies GenericRouteType[];
        const router = new RouterStore(routes, {
            history: createMemoryHistory({ url: '/home' }),
        });

        expect(() => router.navigate('/go/%2F%2Fevil.com')).toThrow(
            /resolves off the app's origin/,
        );
        // Nothing for prepareRoute to report as a followed hop.
        expect(router.redirectHops).toEqual([]);
        router.dispose();
    });
});
