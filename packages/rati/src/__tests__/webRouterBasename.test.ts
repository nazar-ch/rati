import { describe, test, expect, beforeEach } from 'vitest';
import { WebRouterStore } from '../router/store';
import { route } from '../router/route';

const NoopComponent = () => null;

const routes = [
    route('/', 'home', NoopComponent),
    route('/dashboard', 'dashboard', NoopComponent),
    route('/users/:userId', 'user', NoopComponent),
] as const;

beforeEach(() => {
    window.history.replaceState(null, '', 'http://localhost/');
});

describe('WebRouterStore basename', () => {
    test('throws when basename does not start with "/"', () => {
        expect(() => new WebRouterStore({}, routes, { basename: 'admin' })).toThrow();
    });

    test('exposes the normalized basename (trailing slash trimmed)', () => {
        const router = new WebRouterStore({}, routes, { basename: '/admin/' });
        expect(router.basename).toBe('/admin');
        router.dispose();
    });

    test('getPath() prepends basename to named-route URLs', () => {
        const router = new WebRouterStore({}, routes, { basename: '/admin' });
        expect(router.getPath({ name: 'dashboard' })).toBe('/admin/dashboard');
        expect(router.getPath({ name: 'user', userId: '42' })).toBe('/admin/users/42');
        router.dispose();
    });

    test('getPath() returns string arguments verbatim', () => {
        const router = new WebRouterStore({}, routes, { basename: '/admin' });
        // Strings are caller-supplied URLs that may already include basename.
        expect(router.getPath('/raw/url')).toBe('/raw/url');
        router.dispose();
    });

    test('strips basename when matching the current location', async () => {
        window.history.replaceState(null, '', '/admin/dashboard');
        const router = new WebRouterStore({}, routes, { basename: '/admin' });
        // setPath runs synchronously up to the await; flush the microtask queue.
        await Promise.resolve();
        expect(router.path).toBe('/dashboard');
        expect(router.activeRoute?.name).toBe('dashboard');
        router.dispose();
    });

    test('isPath() accepts URL paths (with basename) and compares correctly', async () => {
        window.history.replaceState(null, '', '/admin/dashboard');
        const router = new WebRouterStore({}, routes, { basename: '/admin' });
        await Promise.resolve();
        expect(router.isPath('/admin/dashboard')).toBe(true);
        expect(router.isPath('/admin/users/1')).toBe(false);
        router.dispose();
    });

    test('routes still match correctly when no basename is configured', async () => {
        window.history.replaceState(null, '', '/dashboard');
        const router = new WebRouterStore({}, routes);
        await Promise.resolve();
        expect(router.path).toBe('/dashboard');
        expect(router.activeRoute?.name).toBe('dashboard');
        router.dispose();
    });

    test('treats /admin (no trailing slash) as the basename root', async () => {
        window.history.replaceState(null, '', '/admin');
        const router = new WebRouterStore({}, routes, { basename: '/admin' });
        await Promise.resolve();
        expect(router.path).toBe('/');
        expect(router.activeRoute?.name).toBe('home');
        router.dispose();
    });
});
