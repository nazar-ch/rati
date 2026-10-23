import { describe, test, expect } from 'vite-plus/test';

import { createMemoryHistory } from '../../router/history.js';
import { route } from '../../router/route.js';
import { RouterStore } from '../../router/store.js';

// Arrival at an entry that already exists, the half of setPath the push-side suites never
// reach; each pin names its kill. A memory history owns its stack, so `back`/`forward`
// restore the entry's own state and key and emit POP synchronously.

const NoopComponent = () => null;

const routes = [
    route('/', 'home', NoopComponent),
    route('/dashboard', 'dashboard', NoopComponent),
    route('/users/:userId', 'user', NoopComponent),
    route('*', 'notFound', NoopComponent),
] as const;

describe('Router traversal — back()/forward()/go() on the public surface', () => {
    // The methods pass through to the history, so the pins hold both hosts: the memory
    // history's synchronous POP and the browser's queued one.

    test('go(-1)/back()/forward() on a memory history resolve the restored route in place', () => {
        const history = createMemoryHistory({ url: '/' });
        const router = new RouterStore(routes, { history });
        router.navigate({ name: 'dashboard' });
        router.navigate({ name: 'user', userId: '7' });

        router.back();
        expect(router.activeRoute?.name).toBe('dashboard');
        router.go(-1);
        expect(router.activeRoute?.name).toBe('home');
        router.forward();
        expect(router.activeRoute?.name).toBe('dashboard');

        // Out of range does nothing — the browser's rule, not a clamp to the ends.
        router.go(5);
        expect(router.activeRoute?.name).toBe('dashboard');
        router.dispose();
    });

    test('back() on the browser history pops on a later task and re-resolves', async () => {
        window.history.replaceState(null, '', 'http://localhost/');
        const router = new RouterStore(routes, {});
        router.navigate({ name: 'dashboard' });
        router.navigate({ name: 'user', userId: '7' });

        const popped = new Promise<void>((resolve) => {
            window.addEventListener('popstate', () => resolve(), { once: true });
        });
        router.back();
        // Queued, exactly as documented: nothing to read on the next line.
        expect(router.activeRoute?.name).toBe('user');
        await popped;
        expect(router.activeRoute?.name).toBe('dashboard');
        expect(router.path).toBe('/dashboard');
        router.dispose();
    });
});

describe('RouterStore across back/forward', () => {
    // Kill: compare the marker against the marker string alone, ignoring the counter
    // (stamp `{ skip: this.sessionId }` and test for it) → the marker never goes stale,
    // the POP is skipped, and this reads 'home'.
    test('a POP back onto a shallow entry finds its marker stale and re-resolves', () => {
        const history = createMemoryHistory({ url: '/dashboard' });
        const router = new RouterStore(routes, { history });
        const kept = router.activeRoute;

        // Shallow push: the URL moves to /users/1 while the dashboard stays mounted.
        router.navigate({ name: 'user', userId: '1' }, { keepCurrentRoute: true });
        expect(router.activeRoute).toBe(kept);

        router.navigate({ name: 'home' });
        history.back();

        // The marker is one-shot — armed for the single setPath the push that wrote it
        // emits. Coming back to the entry later is an ordinary arrival: the URL names
        // /users/1 and nothing is keeping the old route, so it must resolve.
        expect(router.path).toBe('/users/1');
        expect(router.activeRoute?.name).toBe('user');
        expect(router.activeRoute?.routeParams).toEqual({ userId: '1' });
        router.dispose();
    });

    // Kill: drop the session id from the comparison (test the counter half alone) —
    // the replayed counter then matches the restored tab's marker, the arrival is
    // skipped, and this reads 'dashboard'.
    test("a shallow entry's marker is stale for the next session's store", () => {
        const history = createMemoryHistory({ url: '/dashboard' });
        const first = new RouterStore(routes, { history });
        first.navigate({ name: 'user', userId: '1' }, { keepCurrentRoute: true });
        history.back();
        first.dispose();

        // A restored tab: the next store reads a marker it did not stamp, and replays the
        // same navigation count over the same stack, so the counter matches. Only the
        // session id, which a new store cannot reproduce, marks the marker foreign.
        const second = new RouterStore(routes, { history });
        expect(second.activeRoute?.name).toBe('dashboard');

        history.forward();

        expect(second.path).toBe('/users/1');
        expect(second.activeRoute?.name).toBe('user');
        second.dispose();
    });

    // Kill: drop `!stateChanged` from setPath's same-path early return — the two entries
    // are then indistinguishable to it and the traversal resolves nothing, leaving the
    // route keyed to the entry the user just left.
    test('stepping back between two entries that share a URL but not their state re-resolves', () => {
        const history = createMemoryHistory({ url: '/users/1' });
        const router = new RouterStore(routes, { history });

        router.navigate('/users/1', { state: { panelId: 'p0' } });
        router.navigate('/users/1', { state: { panelId: 'p1' } });
        const atP1 = router.activeRoute;

        history.back();

        // Same URL on both sides, so `state` is the only thing telling the entries
        // apart: the route has to re-key or a consumer routing off it never learns the
        // back button did anything.
        expect(router.path).toBe('/users/1');
        expect(router.state).toEqual({ panelId: 'p0' });
        expect(router.activeRoute?.name).toBe('user');
        expect(router.activeRoute).not.toBe(atP1);
        router.dispose();
    });
});
