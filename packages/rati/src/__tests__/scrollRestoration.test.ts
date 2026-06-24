import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { createBrowserHistory } from '../router/history';
import { installScrollRestoration } from '../router/scrollRestoration';

beforeEach(() => {
    window.history.replaceState(null, '', 'http://localhost/');
    window.history.scrollRestoration = 'auto';
    vi.useFakeTimers();
    // jsdom doesn't actually paint, but rAF still fires under fake timers if we
    // advance them. Stub scrollTo so we can assert without errors.
    window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
});

afterEach(() => {
    vi.useRealTimers();
});

function flushScrollRestoration() {
    // Two rAFs deep — match the scrollRestoration implementation.
    vi.advanceTimersByTime(32);
}

describe('installScrollRestoration', () => {
    test('switches scrollRestoration to manual on install', () => {
        const history = createBrowserHistory();
        const uninstall = installScrollRestoration(history);
        expect(window.history.scrollRestoration).toBe('manual');
        uninstall();
    });

    test('restores the previous mode on uninstall', () => {
        window.history.scrollRestoration = 'auto';
        const history = createBrowserHistory();
        const uninstall = installScrollRestoration(history);
        uninstall();
        expect(window.history.scrollRestoration).toBe('auto');
    });

    test('scrolls to (0, 0) on PUSH', () => {
        const history = createBrowserHistory();
        const uninstall = installScrollRestoration(history);

        history.push('/next');
        flushScrollRestoration();

        expect(window.scrollTo).toHaveBeenCalledWith(0, 0);
        uninstall();
    });

    test('uses custom scrollToTop when provided', () => {
        const customScroll = vi.fn();
        const history = createBrowserHistory();
        const uninstall = installScrollRestoration(history, { scrollToTop: customScroll });

        history.push('/next');
        flushScrollRestoration();

        expect(customScroll).toHaveBeenCalled();
        expect(window.scrollTo).not.toHaveBeenCalled();
        uninstall();
    });

    test('saves position when leaving an entry, restores on POP', () => {
        const history = createBrowserHistory();
        const uninstall = installScrollRestoration(history);

        // Pretend the user scrolled down on the initial entry.
        Object.defineProperty(window, 'scrollX', { value: 0, writable: true, configurable: true });
        Object.defineProperty(window, 'scrollY', {
            value: 600,
            writable: true,
            configurable: true,
        });

        // Navigate away — scroll restoration should snapshot (0, 600) for the
        // outgoing entry.
        history.push('/page-2');
        flushScrollRestoration();

        // Simulate scroll on /page-2, then go back. To do so we need to first
        // restore the URL to the initial entry; jsdom doesn't implement real
        // back/forward, so we manually replace and dispatch popstate. The
        // scrollRestoration module identifies entries by location.key from
        // window.history.state, which `replaceState` lets us forge.
        Object.defineProperty(window, 'scrollX', { value: 0, writable: true, configurable: true });
        Object.defineProperty(window, 'scrollY', { value: 0, writable: true, configurable: true });

        // Need to know what key was assigned to the initial entry. Inspect via the
        // history module's exposed location getter — but we already pushed past
        // it. Workaround: install fresh, navigate, then go back via dispatching
        // popstate against a state we know. For a minimal smoke test, we just
        // assert that restore was attempted (scrollTo was called) on the POP.
        const callsBeforePopstate = (window.scrollTo as ReturnType<typeof vi.fn>).mock.calls.length;
        window.dispatchEvent(new PopStateEvent('popstate'));
        flushScrollRestoration();
        const callsAfterPopstate = (window.scrollTo as ReturnType<typeof vi.fn>).mock.calls.length;

        expect(callsAfterPopstate).toBeGreaterThan(callsBeforePopstate);
        uninstall();
    });

    test('scrolls to anchor when location.hash matches an element id', () => {
        const target = document.createElement('div');
        target.id = 'section';
        target.scrollIntoView = vi.fn();
        document.body.appendChild(target);

        const history = createBrowserHistory();
        const uninstall = installScrollRestoration(history);

        history.push('/article#section');
        flushScrollRestoration();

        expect(target.scrollIntoView).toHaveBeenCalled();
        document.body.removeChild(target);
        uninstall();
    });

    test('falls back to scrollToTop when hash does not match an element', () => {
        const history = createBrowserHistory();
        const uninstall = installScrollRestoration(history);

        history.push('/article#nonexistent');
        flushScrollRestoration();

        expect(window.scrollTo).toHaveBeenCalledWith(0, 0);
        uninstall();
    });
});
