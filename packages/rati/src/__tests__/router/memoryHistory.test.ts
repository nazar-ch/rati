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
