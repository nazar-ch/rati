import { describe, test, expect, beforeEach } from 'vitest';
import { WebRouterStore } from '../../router/store';
import { route } from '../../router/route';

const NoopComponent = () => null;

const routes = [
    route('/', 'home', NoopComponent),
    route('/search', 'search', NoopComponent),
] as const;

beforeEach(() => {
    window.history.replaceState(null, '', 'http://localhost/');
});

describe('WebRouterStore search / hash exposure', () => {
    test('exposes the raw search string and parsed URLSearchParams', async () => {
        window.history.replaceState(null, '', '/search?q=hello&page=2');
        const router = new WebRouterStore({}, routes);
        await Promise.resolve();
        expect(router.search).toBe('?q=hello&page=2');
        expect(router.searchParams.get('q')).toBe('hello');
        expect(router.searchParams.get('page')).toBe('2');
        router.dispose();
    });

    test('exposes the URL hash including the leading #', async () => {
        window.history.replaceState(null, '', '/search#section');
        const router = new WebRouterStore({}, routes);
        await Promise.resolve();
        expect(router.hash).toBe('#section');
        router.dispose();
    });

    test('search and hash default to empty string when absent', async () => {
        const router = new WebRouterStore({}, routes);
        await Promise.resolve();
        expect(router.search).toBe('');
        expect(router.hash).toBe('');
        router.dispose();
    });

    test('searchParams returns a fresh instance each access (immutable from caller PoV)', async () => {
        window.history.replaceState(null, '', '/?a=1');
        const router = new WebRouterStore({}, routes);
        await Promise.resolve();
        const first = router.searchParams;
        first.set('a', '999');
        // Mutating the returned params must not leak into the store.
        expect(router.searchParams.get('a')).toBe('1');
        router.dispose();
    });

    test('setSearchParams (default replace) updates the URL without growing history', async () => {
        const router = new WebRouterStore({}, routes);
        const startLength = window.history.length;
        router.setSearchParams({ q: 'kittens' });
        expect(window.location.search).toBe('?q=kittens');
        expect(router.search).toBe('?q=kittens');
        expect(router.searchParams.get('q')).toBe('kittens');
        expect(window.history.length).toBe(startLength);
        router.dispose();
    });

    test('setSearchParams with mode: "push" adds a history entry', () => {
        const router = new WebRouterStore({}, routes);
        const startLength = window.history.length;
        router.setSearchParams({ q: 'kittens' }, { mode: 'push' });
        expect(window.location.search).toBe('?q=kittens');
        expect(window.history.length).toBe(startLength + 1);
        router.dispose();
    });

    test('setSearchParams accepts a URLSearchParams instance', () => {
        const router = new WebRouterStore({}, routes);
        const params = new URLSearchParams();
        params.set('a', '1');
        params.append('a', '2');
        router.setSearchParams(params);
        expect(window.location.search).toBe('?a=1&a=2');
        expect(router.searchParams.getAll('a')).toEqual(['1', '2']);
        router.dispose();
    });

    test('setSearchParams clears the search when given empty params', async () => {
        window.history.replaceState(null, '', '/?old=value');
        const router = new WebRouterStore({}, routes);
        await Promise.resolve();
        router.setSearchParams({});
        expect(window.location.search).toBe('');
        expect(router.search).toBe('');
        router.dispose();
    });

    test('setSearchParams preserves the current pathname and hash', async () => {
        window.history.replaceState(null, '', '/search#section');
        const router = new WebRouterStore({}, routes);
        await Promise.resolve();
        router.setSearchParams({ q: 'x' });
        expect(window.location.pathname).toBe('/search');
        expect(window.location.hash).toBe('#section');
        expect(router.hash).toBe('#section');
        router.dispose();
    });

    test('setSearchParams respects basename when building the URL', async () => {
        window.history.replaceState(null, '', '/admin/search');
        const router = new WebRouterStore({}, routes, { basename: '/admin' });
        await Promise.resolve();
        router.setSearchParams({ q: 'x' });
        expect(window.location.pathname).toBe('/admin/search');
        expect(window.location.search).toBe('?q=x');
        // Path observable is still the route-internal path (basename stripped).
        expect(router.path).toBe('/search');
        router.dispose();
    });

    test('search/hash observables update on hash-only navigation (same pathname)', async () => {
        window.history.replaceState(null, '', '/search?q=a');
        const router = new WebRouterStore({}, routes);
        await Promise.resolve();
        expect(router.search).toBe('?q=a');

        window.history.pushState(null, '', '/search?q=b#frag');
        window.dispatchEvent(new PopStateEvent('popstate'));
        await Promise.resolve();
        expect(router.search).toBe('?q=b');
        expect(router.hash).toBe('#frag');
        router.dispose();
    });
});
