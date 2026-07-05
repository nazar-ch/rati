import { describe, test, expect } from 'vite-plus/test';
import { RouterStore } from '../../router/store';
import { route } from '../../router/route';
import { createMemoryHistory } from '../../router/history';

const NoopComponent = () => null;

const routes = [
    route('/', 'home', NoopComponent),
    route('/users/:userId', 'user', NoopComponent),
    route('*', 'notFound', NoopComponent),
] as const;

describe('RouterStore with injected history', () => {
    test('uses the injected history instead of auto-detecting', async () => {
        const history = createMemoryHistory({ url: '/users/42' });
        const router = new RouterStore({}, routes, { history });
        await Promise.resolve();
        expect(router.history).toBe(history);
        expect(router.activeRoute?.name).toBe('user');
        expect(router.activeRoute?.routeParams).toEqual({ userId: '42' });
        router.dispose();
    });

    test('navigates via the injected history without touching window.location', async () => {
        const history = createMemoryHistory({ url: '/' });
        const router = new RouterStore({}, routes, { history });
        await Promise.resolve();
        expect(router.activeRoute?.name).toBe('home');

        history.push('/users/7');
        await Promise.resolve();

        expect(router.path).toBe('/users/7');
        expect(router.activeRoute?.name).toBe('user');
        expect(router.activeRoute?.routeParams).toEqual({ userId: '7' });
        router.dispose();
    });

    test('can match wildcard routes through injected history', async () => {
        const history = createMemoryHistory({ url: '/no/such/route' });
        const router = new RouterStore({}, routes, { history });
        await Promise.resolve();
        expect(router.activeRoute?.name).toBe('notFound');
        router.dispose();
    });
});
