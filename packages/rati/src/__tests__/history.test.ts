import { describe, test, expect, beforeEach, vi } from 'vitest';
import { createBrowserHistory, createHashHistory, createHistory } from '../common/history';

beforeEach(() => {
    // jsdom persists URL state across tests; reset to a known starting point.
    window.history.replaceState(null, '', 'http://localhost/');
});

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
});

describe('createHashHistory', () => {
    test('reads the route from location.hash', () => {
        window.history.replaceState(null, '', '/index.html#/dashboard?tab=users');
        const history = createHashHistory();
        expect(history.location.pathname).toBe('/dashboard');
        expect(history.location.search).toBe('?tab=users');
    });

    test('defaults to "/" when there is no hash', () => {
        window.history.replaceState(null, '', '/index.html');
        const history = createHashHistory();
        expect(history.location.pathname).toBe('/');
    });

    test('push() encodes the route into the hash', () => {
        window.history.replaceState(null, '', '/index.html');
        const history = createHashHistory();
        const listener = vi.fn();
        history.listen(listener);

        history.push('/foo');

        expect(window.location.hash).toBe('#/foo');
        expect(history.location.pathname).toBe('/foo');
        expect(listener.mock.calls[0]![0].action).toBe('PUSH');
    });

    test('replace() updates the hash without growing history', () => {
        window.history.replaceState(null, '', '/index.html#/a');
        const history = createHashHistory();
        history.replace('/b');

        expect(window.location.hash).toBe('#/b');
        expect(history.location.pathname).toBe('/b');
    });
});

describe('createHistory', () => {
    test('uses browser history under http://', () => {
        window.history.replaceState(null, '', '/some/path');
        const history = createHistory();
        expect(history.location.pathname).toBe('/some/path');
    });

    test('honors an explicit type override', () => {
        window.history.replaceState(null, '', '/some/path');
        const history = createHistory({ type: 'hash' });
        // With hash mode forced, pathname comes from the hash (which is empty → "/").
        expect(history.location.pathname).toBe('/');
    });

    // Auto-detection of `file:` → hash mode is one line of code; jsdom makes
    // window.location.protocol non-configurable so we can't mock it without
    // rebuilding the whole environment. Covered indirectly: the file:// path
    // returns createHashHistory(), which is exercised by the createHashHistory
    // suite above.
});
