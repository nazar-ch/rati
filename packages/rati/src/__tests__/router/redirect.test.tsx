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
        const A = () => <div>a</div>;
        const B = () => <div>b</div>;
        const routes = [
            route('/a', 'a', A, { redirect: { to: '/b' } }),
            route('/b', 'b', B, { redirect: { to: '/a' } }),
            route('*', 'notFound', NotFound),
        ] as const satisfies GenericRouteType[];
        const router = new RouterStore({}, routes, {
            history: createMemoryHistory({ url: '/a' }),
        });
        const root = new RootStore({ router }, { isReady: true });
        const view = render(
            <RootStoreProvider rootStore={root}>
                <Router />
            </RootStoreProvider>,
        );

        // Following stopped: one of the cycle's routes is active, rendered as-is.
        // *Which* one is the parity of the cap and deliberately not pinned — the fuzz
        // property makes the same call (see routerAsserts' capped-cycle oneOf).
        expect(['a', 'b']).toContain(router.activeRoute?.name);
        // The half the store-level name cannot show: the route's own component is what
        // reaches the DOM — not the catch-all, and not a blank screen. Two kills, both
        // executed red — returning from the loop-report branch instead of falling
        // through to the assignment below it (which the name above catches too), and the
        // one that needs this line: a Router declining to render a route still carrying
        // a `redirect` declaration, which leaves the store's answer right and the screen
        // empty.
        expect(['a', 'b']).toContain(view.container.textContent);
        // The cap, stated where it is observable: one hop per level the guard allowed
        // and no eleventh. Kill: move MAX_REDIRECT_DEPTH — the trail's length follows it.
        expect(router.redirectHops).toHaveLength(10);
        expect(router.redirectHops[0]).toEqual({ from: '/a', to: '/b', permanent: false });
        expect(error).toHaveBeenCalledOnce();
        expect(error.mock.calls[0]![0]).toContain('redirect loop');
        // The trail rides along in the report, and is the only thing naming which routes
        // the cycle ran through — the first thing a reader needs and the only place it is
        // written down. Kill: drop the hops join from the message. Executed once, red.
        expect(error.mock.calls[0]![0]).toContain('/a → /b → /a');
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

    test('constructed straight at a self-redirect, the cycle still ends at one hop', () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        const Self = () => <div>self</div>;
        const routes = [
            route('/home', 'home', Home),
            route('/self', 'self', Self, { redirect: { to: '/self' } }),
            route('*', 'notFound', NotFound),
        ] as const satisfies GenericRouteType[];
        const router = new RouterStore({}, routes, {
            history: createMemoryHistory({ url: '/self' }),
        });

        // The other way into setPath — no resolved route for the early return to skip
        // past, so before the self-check this entry recursed to the depth cap: the same
        // report after ten identical hops. The check unifies the two entries at one hop;
        // this is the shape RF-06's kill shrank to, pinned here so the property isn't
        // the only witness.
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

    /**
     * RF-07: a relative target is refused where the redirect is followed. This is also the
     * hole RF-06's loop check had — a *relative* self-target walked past a comparison that
     * reads resolutions, because `'self' !== '/self'` as a spelling. Refusing the input
     * class closes it: a spelling can no longer sneak past by not looking like its answer.
     *
     * Kills executed once, 2026-07-17, reverted after. Both guards dropped (the pre-RF-07
     * engine) reproduces the bypass exactly, on the browser history and here: one hop
     * recorded, **no loop reported**, and `home` left on screen at URL `/self` — the stale
     * shape RF-06 fixed, reached by spelling. Both pins go red.
     *
     * Dropping *only* the redirect branch's guard is the sharper kill, and the reason this
     * guard exists rather than leaning on the `replace` one downstream: the target still
     * throws — the nested `replace` refuses it — but says `[rati] replace:` instead of
     * naming the route that declared it, and records the hop before dying, so
     * `redirectHops` reports one it never followed. Both assertions below catch that; the
     * function-redirect pin does not (it goes green), and is regression cover only.
     */
    test('a relative redirect target is refused rather than resolved', () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        const Self = () => <div>self</div>;
        const routes = [
            route('/home', 'home', Home),
            route('/self', 'self', Self, { redirect: { to: 'self' } }),
            route('*', 'notFound', NotFound),
        ] as const satisfies GenericRouteType[];
        const router = new RouterStore({}, routes, {
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
        const router = new RouterStore({}, routes, {
            history: createMemoryHistory({ url: '/home' }),
        });

        // The function's *return* is the target — the string rule reads it there, so a
        // legacy mapper that forgets the leading slash is caught rather than followed.
        expect(() => router.navigate('/old/7')).toThrow(/not an absolute path/);
        router.dispose();
    });

    /**
     * The open-redirect shape the origin check exists for. `:dest` matches one URL
     * segment, but `%2F` decodes to `/` (decodeParams), so a request can hand the mapper
     * a value that composes into `//evil.com` — starts with `/`, passes the absolute-path
     * check, and on the server would ride `prepareRoute` verbatim into the `Location`
     * header: a redirect to an origin the app never chose. Refused where the redirect is
     * followed, before the hop is recorded. Kill: see webRouterCore.test.ts — dropping
     * the origin check turns this red (the memory history quietly lands on `/`, the trail
     * records the authority, and prepareRoute would report it).
     */
    test('a redirect target carrying an authority is refused, not followed', () => {
        const routes = [
            route('/home', 'home', Home),
            route('/go/:dest', 'go', Null, { redirect: { to: ({ dest }) => dest } }),
            route('*', 'notFound', NotFound),
        ] as const satisfies GenericRouteType[];
        const router = new RouterStore({}, routes, {
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
