import { describe, test, expect, beforeEach, vi } from 'vite-plus/test';
import { createBrowserHistory } from '../../router/history';

beforeEach(() => {
    // jsdom persists URL state across tests; reset to a known starting point.
    window.history.replaceState(null, '', 'http://localhost/');
});

/**
 * Resolve on the next `popstate`. jsdom queues a real traversal like a browser does,
 * so a `go`/`back`/`forward` test has to wait for it rather than read the next line.
 * Register before calling: the history's own listener was added first (in its
 * constructor), so by the time this resolves, it has already run.
 */
function nextPopState(): Promise<void> {
    return new Promise((resolve) => {
        window.addEventListener('popstate', () => resolve(), { once: true });
    });
}

describe('createBrowserHistory', () => {
    test('reads the current pathname/search/hash from window.location', () => {
        window.history.replaceState(null, '', '/a?b=c#d');
        const history = createBrowserHistory();
        expect(history.location.pathname).toBe('/a');
        expect(history.location.search).toBe('?b=c');
        expect(history.location.hash).toBe('#d');
    });

    test('push() updates location and notifies listeners with PUSH', () => {
        const history = createBrowserHistory();
        const listener = vi.fn();
        history.listen(listener);

        history.push('/foo');

        expect(window.location.pathname).toBe('/foo');
        expect(history.location.pathname).toBe('/foo');
        expect(listener).toHaveBeenCalledOnce();
        expect(listener.mock.calls[0]![0].action).toBe('PUSH');
        expect(listener.mock.calls[0]![0].location.pathname).toBe('/foo');
    });

    test('replace() updates location and notifies listeners with REPLACE', () => {
        const history = createBrowserHistory();
        const listener = vi.fn();
        history.listen(listener);

        history.replace('/bar');

        expect(window.location.pathname).toBe('/bar');
        expect(listener).toHaveBeenCalledOnce();
        expect(listener.mock.calls[0]![0].action).toBe('REPLACE');
    });

    test('user-supplied state is exposed on location.state, not internal wrapper', () => {
        const history = createBrowserHistory();
        history.push('/x', { count: 7 });
        expect(history.location.state).toEqual({ count: 7 });
    });

    test('each push() generates a fresh location.key', () => {
        const history = createBrowserHistory();
        history.push('/a');
        const firstKey = history.location.key;
        history.push('/b');
        const secondKey = history.location.key;
        expect(firstKey).not.toBe(secondKey);
    });

    test('listen() returns an unsubscribe function', () => {
        const history = createBrowserHistory();
        const listener = vi.fn();
        const unsubscribe = history.listen(listener);

        history.push('/a');
        expect(listener).toHaveBeenCalledOnce();

        unsubscribe();
        history.push('/b');
        expect(listener).toHaveBeenCalledOnce(); // still 1 — listener is gone
    });

    test('popstate fires listeners with POP action', () => {
        const history = createBrowserHistory();
        const listener = vi.fn();
        history.listen(listener);

        // Simulate browser back/forward by dispatching popstate directly.
        window.dispatchEvent(new PopStateEvent('popstate'));

        expect(listener).toHaveBeenCalledOnce();
        expect(listener.mock.calls[0]![0].action).toBe('POP');
    });

    // The memory history owns its stack and so pops synchronously; this one asks the
    // browser and waits. Both halves are the contract (see `History.go`), which is why
    // the "nothing moved yet" asserts are here rather than just the outcome.
    test('go() hands the traversal to the browser, which pops on a later task', async () => {
        const history = createBrowserHistory();
        const listener = vi.fn();
        history.listen(listener);
        history.push('/a');
        history.push('/b');
        listener.mockClear();

        const popped = nextPopState();
        history.go(-1);

        // Queued, not done: the browser hasn't traversed on the next line.
        expect(window.location.pathname).toBe('/b');
        expect(listener).not.toHaveBeenCalled();

        await popped;

        expect(window.location.pathname).toBe('/a');
        expect(listener).toHaveBeenCalledOnce();
        expect(listener.mock.calls[0]![0].action).toBe('POP');
        expect(listener.mock.calls[0]![0].location.pathname).toBe('/a');
        history.dispose!();
    });

    test('forward() steps back down the stack the browser kept', async () => {
        const history = createBrowserHistory();
        history.push('/a');
        history.push('/b');

        const back = nextPopState();
        history.back();
        await back;
        expect(window.location.pathname).toBe('/a');

        const forward = nextPopState();
        history.forward();
        await forward;
        expect(window.location.pathname).toBe('/b');
        history.dispose!();
    });

    test('dispose() detaches from popstate', () => {
        const history = createBrowserHistory();
        const listener = vi.fn();
        history.listen(listener);

        history.dispose!();
        window.dispatchEvent(new PopStateEvent('popstate'));

        expect(listener).not.toHaveBeenCalled();
    });

    test('dispose() drops listeners registered before it', () => {
        const history = createBrowserHistory();
        const listener = vi.fn();
        history.listen(listener);

        history.dispose!();
        history.push('/after-dispose');

        expect(listener).not.toHaveBeenCalled();
    });
});
