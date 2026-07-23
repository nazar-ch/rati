import { describe, test, expect } from 'vite-plus/test';
import { RouterStore } from '../../router/store';
import { route } from '../../router/route';
import { createMemoryHistory } from '../../router/history';

// Arrival at an entry that already exists — the half of setPath the push-side suites
// never reach. Each pin's kill is named at the test and was executed once, red, then
// reverted. A memory history is deliberate: it owns its stack, so `back`/`forward`
// restore the entry's own state and key and emit POP synchronously (the browser's
// traversal is queued, and every POP test written before the stack existed had to
// forge the event, which is what let the scroll-restoration pin rot into a vacuous one).

const NoopComponent = () => null;

const routes = [
    route('/', 'home', NoopComponent),
    route('/dashboard', 'dashboard', NoopComponent),
    route('/users/:userId', 'user', NoopComponent),
    route('*', 'notFound', NoopComponent),
] as const;

describe('RouterStore across back/forward', () => {
    // Kill: compare the marker against the marker string alone, ignoring the counter
    // (stamp `{ skip: this.sessionId }` and test for it) — the marker then never goes
    // stale, the POP is skipped, and this reads 'home': whatever route the traversal
    // left mounted, stranded on an entry whose URL names another one.
    test('a POP back onto a shallow entry finds its marker stale and re-resolves', () => {
        const history = createMemoryHistory({ url: '/dashboard' });
        const router = new RouterStore({}, routes, { history });
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
        const first = new RouterStore({}, routes, { history });
        first.navigate({ name: 'user', userId: '1' }, { keepCurrentRoute: true });
        history.back();
        first.dispose();

        // A restored tab: the entries outlive the store that wrote them, so the next
        // store reads a marker it did not stamp. The counter half is no defense — this
        // store replays the same navigation count over the same stack, so it arrives
        // holding exactly the counter the marker embeds. Only the session id, which a
        // new store cannot reproduce, says the marker belongs to someone else.
        const second = new RouterStore({}, routes, { history });
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
        const router = new RouterStore({}, routes, { history });

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
