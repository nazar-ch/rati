import { describe, test, expect, vi } from 'vite-plus/test';
import { createMemoryHistory } from '../../router/history';

describe('createMemoryHistory', () => {
    test('defaults to "/" when no initial URL is provided', () => {
        const history = createMemoryHistory();
        expect(history.location.pathname).toBe('/');
        expect(history.location.search).toBe('');
        expect(history.location.hash).toBe('');
    });

    test('parses pathname, search, and hash from the initial URL', () => {
        const history = createMemoryHistory({ url: '/users/42?tab=posts#bio' });
        expect(history.location.pathname).toBe('/users/42');
        expect(history.location.search).toBe('?tab=posts');
        expect(history.location.hash).toBe('#bio');
    });

    test('push() updates location and notifies listeners with PUSH', () => {
        const history = createMemoryHistory({ url: '/' });
        const listener = vi.fn();
        history.listen(listener);

        history.push('/foo');

        expect(history.location.pathname).toBe('/foo');
        expect(listener).toHaveBeenCalledOnce();
        expect(listener.mock.calls[0]![0].action).toBe('PUSH');
        expect(listener.mock.calls[0]![0].location.pathname).toBe('/foo');
    });

    test('replace() updates location and notifies listeners with REPLACE', () => {
        const history = createMemoryHistory({ url: '/' });
        const listener = vi.fn();
        history.listen(listener);

        history.replace('/bar');

        expect(history.location.pathname).toBe('/bar');
        expect(listener).toHaveBeenCalledOnce();
        expect(listener.mock.calls[0]![0].action).toBe('REPLACE');
    });

    test('user-supplied state is exposed on location.state', () => {
        const history = createMemoryHistory();
        history.push('/x', { count: 7 });
        expect(history.location.state).toEqual({ count: 7 });
    });

    test('each push() generates a fresh location.key', () => {
        const history = createMemoryHistory();
        const initial = history.location.key;
        history.push('/a');
        const afterA = history.location.key;
        history.push('/b');
        const afterB = history.location.key;
        expect(afterA).not.toBe(initial);
        expect(afterB).not.toBe(afterA);
    });

    test('listen() returns an unsubscribe function', () => {
        const history = createMemoryHistory();
        const listener = vi.fn();
        const unsubscribe = history.listen(listener);

        history.push('/a');
        expect(listener).toHaveBeenCalledOnce();

        unsubscribe();
        history.push('/b');
        expect(listener).toHaveBeenCalledOnce();
    });

    test('notify() fans out an action without changing location', () => {
        const history = createMemoryHistory({ url: '/start' });
        const listener = vi.fn();
        history.listen(listener);

        history.notify('POP');

        expect(history.location.pathname).toBe('/start');
        expect(listener).toHaveBeenCalledOnce();
        expect(listener.mock.calls[0]![0].action).toBe('POP');
    });

    test('replace() generates a fresh key too', () => {
        const history = createMemoryHistory();
        history.push('/a');
        const pushedKey = history.location.key;

        history.replace('/a2');

        // The slot now holds a different page, so scroll restoration must not hand
        // it the position saved under the replaced entry's key. Matches
        // createBrowserHistory's replace, which also re-keys.
        expect(history.location.key).not.toBe(pushedKey);
    });
});

/*
    The entry stack. `createMemoryHistory` used to hold a single location — its doc said
    "back/forward navigation is not modeled" — so every POP test in this suite's siblings
    hand-rolled `replaceState` + a `PopStateEvent` against the *browser* history. These pin
    the stack that replaced it (RF-02): the semantics are the browser's, so they are worth
    stating as their own contract rather than leaving to the fuzz suite that drives them.
*/
describe('createMemoryHistory — the entry stack', () => {
    test('go() moves the index and reports POP', () => {
        const history = createMemoryHistory({ url: '/a' });
        history.push('/b');
        history.push('/c');
        const listener = vi.fn();
        history.listen(listener);

        history.go(-2);

        expect(history.location.pathname).toBe('/a');
        expect(listener).toHaveBeenCalledOnce();
        expect(listener.mock.calls[0]![0].action).toBe('POP');
        expect(listener.mock.calls[0]![0].location.pathname).toBe('/a');
    });

    test('back() and forward() step one entry each way', () => {
        const history = createMemoryHistory({ url: '/a' });
        history.push('/b');

        history.back();
        expect(history.location.pathname).toBe('/a');

        history.forward();
        expect(history.location.pathname).toBe('/b');
    });

    test('a traversed entry restores its own state and key, rather than fresh ones', () => {
        const history = createMemoryHistory({ url: '/a' });
        history.push('/b', { panel: 'left' });
        const bKey = history.location.key;
        history.push('/c', { panel: 'right' });

        history.back();

        // The whole point of the stack: POP hands back the entry as it was pushed.
        // A regenerated key would break scroll restoration (it looks up the saved
        // position by key), and a dropped state would break `router.state` across
        // back/forward.
        expect(history.location.state).toEqual({ panel: 'left' });
        expect(history.location.key).toBe(bKey);
    });

    test('push() drops the forward tail', () => {
        const history = createMemoryHistory({ url: '/a' });
        history.push('/b');
        history.back();
        // At `/a` with `/b` ahead of us. Pushing here starts a new branch, and the
        // old one has to become unreachable.
        history.push('/c');
        expect(history.location.pathname).toBe('/c');

        history.back();

        // Lands on the entry we branched from. Asserting through `back` is what makes
        // this bite: a push that appends without truncating still leaves the index at
        // the tip, so `forward` is a no-op either way and the orphaned `/b` hides
        // *behind* the new entry — where only a back step finds it.
        expect(history.location.pathname).toBe('/a');
    });

    test('replace() leaves the forward tail reachable', () => {
        const history = createMemoryHistory({ url: '/a' });
        history.push('/b');
        history.back();

        history.replace('/a2');

        // Unlike push: swapping the entry in place doesn't cut the branch.
        expect(history.location.pathname).toBe('/a2');
        history.forward();
        expect(history.location.pathname).toBe('/b');
    });

    test('going out of range does nothing at all — no move, no POP', () => {
        const history = createMemoryHistory({ url: '/a' });
        history.push('/b');
        const listener = vi.fn();
        history.listen(listener);

        // The browser's rule: there is no entry there, so no traversal happens. It
        // does not clamp to the ends, which would report a POP that never occurred.
        history.go(-5);
        history.forward();

        expect(history.location.pathname).toBe('/b');
        expect(listener).not.toHaveBeenCalled();
    });

    test('go(0) does nothing — the browser reloads, a memory history has nothing to reload', () => {
        const history = createMemoryHistory({ url: '/a' });
        const listener = vi.fn();
        history.listen(listener);

        history.go(0);

        expect(history.location.pathname).toBe('/a');
        expect(listener).not.toHaveBeenCalled();
    });

    test('the sugar survives destructuring — go/back/forward are not `this`-bound', () => {
        const history = createMemoryHistory({ url: '/a' });
        history.push('/b');
        // Callers hand these to a button's onClick. They must work detached.
        const { back, forward } = history;

        back();
        expect(history.location.pathname).toBe('/a');
        forward();
        expect(history.location.pathname).toBe('/b');
    });
});

describe('createMemoryHistory — hostlessness', () => {
    test('does not touch window or document', () => {
        // Smoke-check: constructing and using memory history with window
        // temporarily shadowed should still work. If the implementation reaches
        // for `window.*` anywhere, this throws.
        const realWindow = globalThis.window;
        const realDocument = globalThis.document;
        try {
            // @ts-expect-error — intentional override for the test
            globalThis.window = undefined;
            // @ts-expect-error — intentional override for the test
            globalThis.document = undefined;

            const history = createMemoryHistory({ url: '/x?y=z#w' });
            history.push('/a');
            history.replace('/b', { k: 1 });
            history.notify('POP');

            expect(history.location.pathname).toBe('/b');
            expect(history.location.state).toEqual({ k: 1 });
        } finally {
            globalThis.window = realWindow;
            globalThis.document = realDocument;
        }
    });
});
