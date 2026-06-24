import { describe, test, expect, beforeEach } from 'vitest';
import { WebRouterStore } from '../router/store';
import { route } from '../router/route';

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

describe('WebRouterStore route matching', () => {
    test('matches the root route on initial load', async () => {
        const router = new WebRouterStore({}, routes);
        await Promise.resolve();
        expect(router.activeRoute?.name).toBe('home');
        expect(router.path).toBe('/');
        router.dispose();
    });

    test('matches a static route from the URL', async () => {
        window.history.replaceState(null, '', '/dashboard');
        const router = new WebRouterStore({}, routes);
        await Promise.resolve();
        expect(router.activeRoute?.name).toBe('dashboard');
        router.dispose();
    });

    test('extracts a single path parameter', async () => {
        window.history.replaceState(null, '', '/users/42');
        const router = new WebRouterStore({}, routes);
        await Promise.resolve();
        expect(router.activeRoute?.name).toBe('user');
        expect(router.activeRoute?.routeParams).toEqual({ userId: '42' });
        router.dispose();
    });

    test('extracts multiple path parameters', async () => {
        window.history.replaceState(null, '', '/users/42/posts/abc');
        const router = new WebRouterStore({}, routes);
        await Promise.resolve();
        expect(router.activeRoute?.name).toBe('userPost');
        expect(router.activeRoute?.routeParams).toEqual({ userId: '42', postId: 'abc' });
        router.dispose();
    });

    test('falls through to the wildcard catch-all when nothing matches', async () => {
        window.history.replaceState(null, '', '/no/such/route');
        const router = new WebRouterStore({}, routes);
        await Promise.resolve();
        expect(router.activeRoute?.name).toBe('notFound');
        router.dispose();
    });

    test('leaves activeRoute null when no route matches and no catch-all is defined', async () => {
        const noCatchAll = [route('/known', 'known', NoopComponent)] as const;
        window.history.replaceState(null, '', '/unknown');
        const router = new WebRouterStore({}, noCatchAll);
        await Promise.resolve();
        expect(router.activeRoute).toBeFalsy();
        router.dispose();
    });

    test('matches paths with or without a trailing slash', async () => {
        window.history.replaceState(null, '', '/dashboard/');
        const router = new WebRouterStore({}, routes);
        await Promise.resolve();
        expect(router.activeRoute?.name).toBe('dashboard');
        router.dispose();
    });
});

describe('WebRouterStore.getPath', () => {
    test('returns the path verbatim for parameterless routes', () => {
        const router = new WebRouterStore({}, routes);
        expect(router.getPath({ name: 'dashboard' })).toBe('/dashboard');
        router.dispose();
    });

    test('substitutes params into the path', () => {
        const router = new WebRouterStore({}, routes);
        expect(router.getPath({ name: 'user', userId: '42' })).toBe('/users/42');
        expect(router.getPath({ name: 'userPost', userId: '42', postId: 'abc' })).toBe(
            '/users/42/posts/abc'
        );
        router.dispose();
    });

    test('returns string arguments verbatim', () => {
        const router = new WebRouterStore({}, routes);
        expect(router.getPath('/raw/url?x=1#y')).toBe('/raw/url?x=1#y');
        router.dispose();
    });
});

describe('WebRouterStore.isPath', () => {
    test('matches the current path', async () => {
        window.history.replaceState(null, '', '/dashboard');
        const router = new WebRouterStore({}, routes);
        await Promise.resolve();
        expect(router.isPath('/dashboard')).toBe(true);
        expect(router.isPath('/users/1')).toBe(false);
        router.dispose();
    });
});

describe('WebRouterStore navigation', () => {
    test('navigate() pushes a new history entry and resolves the route', async () => {
        const router = new WebRouterStore({}, routes);
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
        const router = new WebRouterStore({}, routes);
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
        const router = new WebRouterStore({}, routes);
        await Promise.resolve();
        router.replace('/dashboard');
        await Promise.resolve();
        expect(router.path).toBe('/dashboard');
        router.dispose();
    });

    test('replace({ keepCurrentRoute: true }) updates the URL but keeps the current route mounted', async () => {
        window.history.replaceState(null, '', '/dashboard');
        const router = new WebRouterStore({}, routes);
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

    test('history.push() triggers a route resolution', async () => {
        const router = new WebRouterStore({}, routes);
        await Promise.resolve();

        router.history.push('/dashboard');
        await Promise.resolve();
        expect(router.activeRoute?.name).toBe('dashboard');
        router.dispose();
    });

    test('does not re-resolve the route when navigating to the same pathname', async () => {
        window.history.replaceState(null, '', '/dashboard');
        const router = new WebRouterStore({}, routes);
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

describe('WebRouterStore.dispose', () => {
    test('stops responding to history changes after dispose', async () => {
        const router = new WebRouterStore({}, routes);
        await Promise.resolve();
        router.dispose();

        // Manually push past dispose — router should not pick it up.
        const pathBefore = router.path;
        window.history.pushState(null, '', '/dashboard');
        window.dispatchEvent(new PopStateEvent('popstate'));
        await Promise.resolve();
        expect(router.path).toBe(pathBefore);
    });
});
