import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { WebRouterStore } from '../router/store';
import { route } from '../router/route';

const NoopComponent = () => null;

const routes = [
    route('/', 'home', NoopComponent),
    route('/article', 'article', NoopComponent),
] as const;

beforeEach(() => {
    window.history.replaceState(null, '', 'http://localhost/');
    window.history.scrollRestoration = 'auto';
    vi.useFakeTimers();
    window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
});

afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
});

function flushScrollRestoration() {
    vi.advanceTimersByTime(32);
}

describe('WebRouterStore hash anchor navigation', () => {
    test('scrolls to anchor element when navigating to a hash on the current page', async () => {
        window.history.replaceState(null, '', '/article');
        const router = new WebRouterStore({}, routes);
        await Promise.resolve();

        const target = document.createElement('div');
        target.id = 'section';
        target.scrollIntoView = vi.fn();
        document.body.appendChild(target);

        router.history.push('/article#section');
        flushScrollRestoration();

        expect(router.hash).toBe('#section');
        expect(target.scrollIntoView).toHaveBeenCalled();
        router.dispose();
    });

    test('updates the hash observable without re-rendering the route', async () => {
        window.history.replaceState(null, '', '/article');
        const router = new WebRouterStore({}, routes);
        await Promise.resolve();

        // Capture the active route before the hash change.
        const routeBefore = router.activeRoute;
        expect(routeBefore?.name).toBe('article');

        router.history.push('/article#part-2');
        await Promise.resolve();

        // Same route object — hash change shouldn't trigger a re-resolve.
        expect(router.activeRoute).toBe(routeBefore);
        expect(router.hash).toBe('#part-2');
        router.dispose();
    });
});
