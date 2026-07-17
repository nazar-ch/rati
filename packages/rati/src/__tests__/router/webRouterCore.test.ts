import { describe, test, expect, beforeEach, vi } from 'vite-plus/test';
import { RouterStore } from '../../router/store';
import { route } from '../../router/route';
import { createMemoryHistory } from '../../router/history';

const NoopComponent = () => null;

const routes = [
    route('/', 'home', NoopComponent),
    route('/dashboard', 'dashboard', NoopComponent),
    route('/users/:userId', 'user', NoopComponent),
    route('/users/:userId/posts/:postId', 'userPost', NoopComponent),
    route('*', 'notFound', NoopComponent),
] as const;

beforeEach(() => {
    window.history.replaceState(null, '', 'http://localhost/');
});

describe('RouterStore route matching', () => {
    test('matches the root route on initial load', async () => {
        const router = new RouterStore({}, routes);
        await Promise.resolve();
        expect(router.activeRoute?.name).toBe('home');
        expect(router.path).toBe('/');
        router.dispose();
    });

    test('matches a static route from the URL', async () => {
        window.history.replaceState(null, '', '/dashboard');
        const router = new RouterStore({}, routes);
        await Promise.resolve();
        expect(router.activeRoute?.name).toBe('dashboard');
        router.dispose();
    });

    test('extracts a single path parameter', async () => {
        window.history.replaceState(null, '', '/users/42');
        const router = new RouterStore({}, routes);
        await Promise.resolve();
        expect(router.activeRoute?.name).toBe('user');
        expect(router.activeRoute?.routeParams).toEqual({ userId: '42' });
        router.dispose();
    });

    test('extracts multiple path parameters', async () => {
        window.history.replaceState(null, '', '/users/42/posts/abc');
        const router = new RouterStore({}, routes);
        await Promise.resolve();
        expect(router.activeRoute?.name).toBe('userPost');
        expect(router.activeRoute?.routeParams).toEqual({ userId: '42', postId: 'abc' });
        router.dispose();
    });

    test('falls through to the wildcard catch-all when nothing matches', async () => {
        window.history.replaceState(null, '', '/no/such/route');
        const router = new RouterStore({}, routes);
        await Promise.resolve();
        expect(router.activeRoute?.name).toBe('notFound');
        router.dispose();
    });

    test('leaves activeRoute null when no route matches and no catch-all is defined', async () => {
        const noCatchAll = [route('/known', 'known', NoopComponent)] as const;
        window.history.replaceState(null, '', '/unknown');
        const router = new RouterStore({}, noCatchAll);
        await Promise.resolve();
        expect(router.activeRoute).toBeFalsy();
        router.dispose();
    });

    test('matches paths with or without a trailing slash', async () => {
        window.history.replaceState(null, '', '/dashboard/');
        const router = new RouterStore({}, routes);
        await Promise.resolve();
        expect(router.activeRoute?.name).toBe('dashboard');
        router.dispose();
    });
});

describe('RouterStore.getPath', () => {
    test('returns the path verbatim for parameterless routes', () => {
        const router = new RouterStore({}, routes);
        expect(router.getPath({ name: 'dashboard' })).toBe('/dashboard');
        router.dispose();
    });

    test('substitutes params into the path', () => {
        const router = new RouterStore({}, routes);
        expect(router.getPath({ name: 'user', userId: '42' })).toBe('/users/42');
        expect(router.getPath({ name: 'userPost', userId: '42', postId: 'abc' })).toBe(
            '/users/42/posts/abc',
        );
        router.dispose();
    });

    test('returns string arguments verbatim', () => {
        const router = new RouterStore({}, routes);
        expect(router.getPath('/raw/url?x=1#y')).toBe('/raw/url?x=1#y');
        router.dispose();
    });

    // Observed red once against the unfixed engine, which threw the TypeError below.
    test('throws a named error for a route that is not in the table', () => {
        const router = new RouterStore({}, routes);
        // A typo in a route name used to surface as `Cannot read properties of
        // undefined (reading 'path')` from the non-null assertion on `find`.
        expect(() => router.getPath({ name: 'dashbaord' } as never)).toThrow(
            '[rati] getPath: no route named "dashbaord"',
        );
        router.dispose();
    });
});

describe('RouterStore.isPath', () => {
    test('matches the current path', async () => {
        window.history.replaceState(null, '', '/dashboard');
        const router = new RouterStore({}, routes);
        await Promise.resolve();
        expect(router.isPath('/dashboard')).toBe(true);
        expect(router.isPath('/users/1')).toBe(false);
        router.dispose();
    });
});

describe('RouterStore navigation', () => {
    test('navigate() pushes a new history entry and resolves the route', async () => {
        const router = new RouterStore({}, routes);
        await Promise.resolve();
        const startLength = window.history.length;

        router.navigate({ name: 'user', userId: '7' });
        await Promise.resolve();

        expect(window.location.pathname).toBe('/users/7');
        expect(router.path).toBe('/users/7');
        expect(router.activeRoute?.name).toBe('user');
        // push grows the back stack
        expect(window.history.length).toBe(startLength + 1);
        router.dispose();
    });

    test('replace() updates the URL via history.replace', async () => {
        const router = new RouterStore({}, routes);
        await Promise.resolve();
        const startLength = window.history.length;

        router.replace({ name: 'user', userId: '7' });
        await Promise.resolve();

        expect(window.location.pathname).toBe('/users/7');
        expect(router.path).toBe('/users/7');
        expect(router.activeRoute?.name).toBe('user');
        // replace doesn't grow the back stack
        expect(window.history.length).toBe(startLength);
        router.dispose();
    });

    test('replace() accepts a string URL', async () => {
        const router = new RouterStore({}, routes);
        await Promise.resolve();
        router.replace('/dashboard');
        await Promise.resolve();
        expect(router.path).toBe('/dashboard');
        router.dispose();
    });

    test('replace({ keepCurrentRoute: true }) updates the URL but keeps the current route mounted', async () => {
        window.history.replaceState(null, '', '/dashboard');
        const router = new RouterStore({}, routes);
        await Promise.resolve();
        const before = router.activeRoute;

        router.replace({ name: 'user', userId: '1' }, { keepCurrentRoute: true });
        await Promise.resolve();

        expect(window.location.pathname).toBe('/users/1');
        // Path observable updates even though the route itself was skipped.
        expect(router.path).toBe('/users/1');
        // Route object is the previous one (keepCurrentRoute flagged this as skip).
        expect(router.activeRoute).toBe(before);
        router.dispose();
    });

    test('navigate({ keepCurrentRoute: true }) grows the back stack but keeps the route mounted', async () => {
        window.history.replaceState(null, '', '/dashboard');
        const router = new RouterStore({}, routes);
        await Promise.resolve();
        const before = router.activeRoute;
        const startLength = window.history.length;

        router.navigate({ name: 'user', userId: '1' }, { keepCurrentRoute: true });
        await Promise.resolve();

        expect(window.location.pathname).toBe('/users/1');
        expect(router.path).toBe('/users/1');
        // Shallow push: a new history entry (unlike a keepCurrentRoute replace)...
        expect(window.history.length).toBe(startLength + 1);
        // ...but the mounted route is untouched (skip marker suppressed the resolve).
        expect(router.activeRoute).toBe(before);
        router.dispose();
    });

    test('navigate({ keepCurrentRoute, state }) stamps the entry and exposes the state', async () => {
        window.history.replaceState(null, '', '/dashboard');
        const router = new RouterStore({}, routes);
        await Promise.resolve();
        const before = router.activeRoute;

        router.navigate(
            { name: 'user', userId: '1' },
            {
                keepCurrentRoute: true,
                state: { panelId: 'p0' },
            },
        );
        await Promise.resolve();

        expect(router.activeRoute).toBe(before);
        expect((router.state as { panelId?: string }).panelId).toBe('p0');
        router.dispose();
    });

    test('a state-only change on the same path re-resolves the route', async () => {
        window.history.replaceState(null, '', '/users/1');
        const router = new RouterStore({}, routes);
        await Promise.resolve();
        const before = router.activeRoute;

        // Same URL, different per-entry state — models stepping between two panels
        // that share a page. The route must re-key so route-keyed consumers react.
        router.navigate('/users/1', { state: { panelId: 'p1' } });
        await Promise.resolve();

        expect(router.path).toBe('/users/1');
        expect(router.activeRoute?.name).toBe('user');
        expect(router.activeRoute).not.toBe(before);
        expect((router.state as { panelId?: string }).panelId).toBe('p1');
        router.dispose();
    });

    test('a same-path navigation with equal state does not re-resolve', async () => {
        window.history.replaceState(null, '', '/users/1');
        const router = new RouterStore({}, routes);
        await Promise.resolve();

        router.navigate('/users/1', { state: { panelId: 'p0' } });
        await Promise.resolve();
        const afterFirst = router.activeRoute;

        // Re-navigating to the same URL with an equal-by-value state is a no-op for
        // resolution (guards the StrictMode/mount-race re-fire and needless remounts).
        router.navigate('/users/1', { state: { panelId: 'p0' } });
        await Promise.resolve();

        expect(router.activeRoute).toBe(afterFirst);
        router.dispose();
    });

    test('history.push() triggers a route resolution', async () => {
        const router = new RouterStore({}, routes);
        await Promise.resolve();

        router.history.push('/dashboard');
        await Promise.resolve();
        expect(router.activeRoute?.name).toBe('dashboard');
        router.dispose();
    });

    test('does not re-resolve the route when navigating to the same pathname', async () => {
        window.history.replaceState(null, '', '/dashboard');
        const router = new RouterStore({}, routes);
        await Promise.resolve();
        const before = router.activeRoute;

        router.history.push('/dashboard?x=1');
        await Promise.resolve();
        // Same pathname → same active route object, but search updated.
        expect(router.activeRoute).toBe(before);
        expect(router.search).toBe('?x=1');
        router.dispose();
    });
});

/**
 * RF-07: the router's string vocabulary is absolute paths. A relative one would mean two
 * different places on the two histories, so it is refused at the choke point instead.
 *
 * Kill executed once (2026-07-17, reverted after): dropping the `assertAbsolutePathTarget`
 * call from `pushOrReplace` turns all nine refusal pins red — the string is pushed
 * verbatim, and where it lands then depends on which history is underneath, which is the
 * whole reason for the rule. The absolute and object pins stay green.
 */
describe('RouterStore refuses a non-absolute string target', () => {
    test.each([
        ['a relative segment', 'sub'],
        ['a parent reference', '..'],
        ['a current-directory reference', '.'],
        ['a query-only reference', '?q=1'],
        ['a hash-only reference', '#section'],
        ['an absolute URL', 'https://example.com/x'],
        ['an empty string', ''],
    ])('navigate rejects %s', async (_label, target) => {
        window.history.replaceState(null, '', '/users/1');
        const router = new RouterStore({}, routes);
        await Promise.resolve();

        expect(() => router.navigate(target)).toThrow(/not an absolute path/);
        // Refused before anything moved.
        expect(router.path).toBe('/users/1');
        router.dispose();
    });

    test('replace rejects a relative string, naming itself', async () => {
        const router = new RouterStore({}, routes);
        await Promise.resolve();

        expect(() => router.replace('sub')).toThrow(/\[rati\] replace:/);
        router.dispose();
    });

    test('the error names the alternatives', async () => {
        const router = new RouterStore({}, routes);
        await Promise.resolve();

        expect(() => router.navigate('sub')).toThrow(/getPath|setSearchParams|<Link>/);
        router.dispose();
    });

    test('absolute string targets still navigate', async () => {
        const router = new RouterStore({}, routes);
        await Promise.resolve();

        router.navigate('/dashboard');
        await Promise.resolve();
        expect(router.activeRoute?.name).toBe('dashboard');
        router.dispose();
    });

    test('an object target is unaffected — the table builds an absolute path', async () => {
        const router = new RouterStore({}, routes);
        await Promise.resolve();

        router.navigate({ name: 'user', userId: '7' });
        await Promise.resolve();
        expect(router.path).toBe('/users/7');
        router.dispose();
    });
});

describe('RouterStore.dispose', () => {
    test('stops responding to history changes after dispose', async () => {
        const router = new RouterStore({}, routes);
        await Promise.resolve();
        router.dispose();

        // Manually push past dispose — router should not pick it up.
        const pathBefore = router.path;
        window.history.pushState(null, '', '/dashboard');
        window.dispatchEvent(new PopStateEvent('popstate'));
        await Promise.resolve();
        expect(router.path).toBe(pathBefore);
    });

    // Observed red once against the unfixed engine: the created history kept its
    // popstate subscription past dispose. Note the listener goes on *after* dispose —
    // registering it before would pass either way, since unlistening the store already
    // empties that set. The leak is only visible to a listener the disposed history
    // should no longer be able to reach.
    test('dispose() detaches the history the store created from the DOM', async () => {
        const router = new RouterStore({}, routes);
        await Promise.resolve();
        const history = router.history;
        router.dispose();

        const listener = vi.fn();
        history.listen(listener);
        window.dispatchEvent(new PopStateEvent('popstate'));

        expect(listener).not.toHaveBeenCalled();
    });

    // The mirror image, and green from the start: it guards the ownership rule against
    // the over-eager fix. The listener must be registered *before* dispose — a store
    // that wrongly disposed an injected history would clear this set.
    test('dispose() leaves an injected history alone — it belongs to the caller', async () => {
        const history = createMemoryHistory({ url: '/' });
        const listener = vi.fn();
        history.listen(listener);

        const router = new RouterStore({}, routes, { history });
        await Promise.resolve();
        router.dispose();

        // The caller may outlive the store, or share one history across stores.
        history.push('/dashboard');
        expect(listener).toHaveBeenCalledOnce();
    });
});
