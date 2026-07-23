import { describe, test, expect, beforeEach } from 'vite-plus/test';
import { RouterStore } from '../../router/store';
import { route } from '../../router/route';

const NoopComponent = () => null;

const routes = [
    route('/', 'home', NoopComponent),
    route('/dashboard', 'dashboard', NoopComponent),
    route('/users/:userId', 'user', NoopComponent),
] as const;

beforeEach(() => {
    window.history.replaceState(null, '', 'http://localhost/');
});

describe('RouterStore basename', () => {
    test('throws when basename does not start with "/"', () => {
        expect(() => new RouterStore({}, routes, { basename: 'admin' })).toThrow();
    });

    test('exposes the normalized basename (trailing slash trimmed)', () => {
        const router = new RouterStore({}, routes, { basename: '/admin/' });
        expect(router.basename).toBe('/admin');
        router.dispose();
    });

    test('getPath() prepends basename to named-route URLs', () => {
        const router = new RouterStore({}, routes, { basename: '/admin' });
        expect(router.getPath({ name: 'dashboard' })).toBe('/admin/dashboard');
        expect(router.getPath({ name: 'user', userId: '42' })).toBe('/admin/users/42');
        router.dispose();
    });

    test('getPath() returns string arguments verbatim', () => {
        const router = new RouterStore({}, routes, { basename: '/admin' });
        // Strings are caller-supplied URLs that may already include basename.
        expect(router.getPath('/raw/url')).toBe('/raw/url');
        router.dispose();
    });

    test('strips basename when matching the current location', async () => {
        window.history.replaceState(null, '', '/admin/dashboard');
        const router = new RouterStore({}, routes, { basename: '/admin' });
        // setPath runs synchronously up to the await; flush the microtask queue.
        await Promise.resolve();
        expect(router.path).toBe('/dashboard');
        expect(router.activeRoute?.name).toBe('dashboard');
        router.dispose();
    });

    test('isPath() accepts URL paths (with basename) and compares correctly', async () => {
        window.history.replaceState(null, '', '/admin/dashboard');
        const router = new RouterStore({}, routes, { basename: '/admin' });
        await Promise.resolve();
        expect(router.isPath('/admin/dashboard')).toBe(true);
        expect(router.isPath('/admin/users/1')).toBe(false);
        router.dispose();
    });

    test('routes still match correctly when no basename is configured', async () => {
        window.history.replaceState(null, '', '/dashboard');
        const router = new RouterStore({}, routes);
        await Promise.resolve();
        expect(router.path).toBe('/dashboard');
        expect(router.activeRoute?.name).toBe('dashboard');
        router.dispose();
    });

    test('treats /admin (no trailing slash) as the basename root', async () => {
        window.history.replaceState(null, '', '/admin');
        const router = new RouterStore({}, routes, { basename: '/admin' });
        await Promise.resolve();
        expect(router.path).toBe('/');
        expect(router.activeRoute?.name).toBe('home');
        router.dispose();
    });

    // Kill: return '/' from stripBasename's third branch instead of the pathname —
    // the URL then reads as the app's root and 'home' renders for an address the app
    // was never mounted at. Executed once, red. The catch-all must be last, so this
    // table is local rather than the shared one above.
    test('a pathname outside the basename falls through to the catch-all', async () => {
        const routesWithCatchAll = [
            route('/', 'home', NoopComponent),
            route('/dashboard', 'dashboard', NoopComponent),
            route('*', 'notFound', NoopComponent),
        ] as const;
        window.history.replaceState(null, '', '/other/page');
        const router = new RouterStore({}, routesWithCatchAll, { basename: '/admin' });
        await Promise.resolve();

        // A pathname that doesn't live under the basename is handed to the matcher
        // as-is rather than mangled into one that does, so the app answers for it with
        // the 404 it defines. Stripping is not the same as claiming: /other/page is
        // not /admin's, and it is not the root either.
        expect(router.path).toBe('/other/page');
        expect(router.activeRoute?.name).toBe('notFound');
        router.dispose();
    });
});
