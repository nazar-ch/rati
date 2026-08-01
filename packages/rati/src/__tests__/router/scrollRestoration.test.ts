import { describe, test, expect, beforeEach, afterEach, vi } from 'vite-plus/test';
import { createBrowserHistory, createMemoryHistory } from '../../router/history';
import { installScrollRestoration } from '../../router/scrollRestoration';

beforeEach(() => {
    window.history.replaceState(null, '', 'http://localhost/');
    window.history.scrollRestoration = 'auto';
    vi.useFakeTimers();
    // jsdom doesn't actually paint, but rAF still fires under fake timers if we
    // advance them. Stub scrollTo so we can assert without errors.
    window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
    setScroll(0, 0);
});

afterEach(() => {
    vi.useRealTimers();
    // Anchor targets are looked up by id, and getElementById answers with the first
    // match — so a test that fails before its inline cleanup hands the *next* anchor
    // test a stale element and a second, spurious failure. Clear the DOM here rather
    // than trusting each test to reach the end.
    document.body.innerHTML = '';
});

function flushScrollRestoration() {
    // Two rAFs deep — match the scrollRestoration implementation.
    vi.advanceTimersByTime(32);
}

/**
 * jsdom has no layout, so the position the module reads back is whatever we say it
 * is. Reset per test (beforeEach) — a leaked scroll offset is invisible until some
 * later pin happens to depend on it.
 */
function setScroll(x: number, y: number) {
    Object.defineProperty(window, 'scrollX', { value: x, writable: true, configurable: true });
    Object.defineProperty(window, 'scrollY', { value: y, writable: true, configurable: true });
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

    // The three POP branches below are pinned as key bookkeeping — which branch ran,
    // not where the viewport ended up (jsdom has no layout, so the pixels are ours
    // either way). A memory history is what makes them writable: it restores the
    // entry's own key on traversal, which is the whole input to the position lookup.
    // The suite previously forged POP by dispatching a bare popstate event, which
    // changes neither the URL nor `window.history.state` — so `readLocation` handed
    // back the key of the entry the test had just pushed *to*, the saved position was
    // never looked up, and the assertion (scrollTo was called at all) held whatever
    // the module did. Deleting the entire restore branch left that test green.

    // Kill: delete the `if (action === 'POP')` restore block — the POP then takes the
    // PUSH path and this reads (0, 0), which is exactly what the old forged-popstate
    // test could not tell apart from a restore. Executed once, red.
    test('POP restores the position saved for the entry being returned to', () => {
        const history = createMemoryHistory({ url: '/a' });
        const uninstall = installScrollRestoration(history);

        // The user scrolled down /a, then left it: the outgoing entry's position is
        // snapshotted against /a's key.
        setScroll(0, 600);
        history.push('/b');
        flushScrollRestoration();

        // Back onto /a from the top of /b. The position must come back from /a's own
        // key rather than from whichever entry is current.
        setScroll(0, 0);
        history.back();
        flushScrollRestoration();

        expect(window.scrollTo).toHaveBeenLastCalledWith(0, 600);
        uninstall();
    });

    // Kill: drop the `if (saved)` guard — the unguarded read throws on the entry that
    // has no saved position. Executed once, red. Note the guard is all this pin can
    // catch: a mutant defaulting the lookup to (0, 0) lands on the same call and is
    // caught by the anchor pin below instead, which is the branch that can tell a
    // fall-through from a restore-to-top.
    test('POP to an entry with no saved position falls through to the top', () => {
        const history = createMemoryHistory({ url: '/a' });
        history.push('/b');
        history.back();

        // Install only now, so the stack outlives the bookkeeping: /b is reachable by
        // forward but was never left in *this* session. Saved positions live in memory
        // for the session while the entries do not — the shape a reload leaves behind.
        const uninstall = installScrollRestoration(history);
        setScroll(0, 300);
        history.forward();
        flushScrollRestoration();

        expect(window.scrollTo).toHaveBeenLastCalledWith(0, 0);
        uninstall();
    });

    // Kill: return after the POP lookup instead of falling through (`if (saved) {…}
    // scrollToTop(); return;` — the plausible "restore or top" simplification) — the
    // anchor is then never consulted and this reads red. Executed once.
    test('POP to an unvisited entry with a hash scrolls to the anchor, not the top', () => {
        const target = document.createElement('div');
        target.id = 'section';
        target.scrollIntoView = vi.fn();
        document.body.appendChild(target);

        const history = createMemoryHistory({ url: '/a' });
        history.push('/b#section');
        history.back();
        const uninstall = installScrollRestoration(history);

        history.forward();
        flushScrollRestoration();

        // No saved position, so the entry falls through to the PUSH behavior — and
        // that behavior is anchor-first, not top. A back button landing on a
        // deep-linked entry it has never seen owes the reader the section they asked
        // for.
        expect(target.scrollIntoView).toHaveBeenCalled();
        expect(window.scrollTo).not.toHaveBeenCalled();
        document.body.removeChild(target);
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
        // The anchor *wins*, rather than merely also running. Kill: drop the `return`
        // after scrollIntoView — the fall-through then scrolls to top as well, landing
        // the reader at the top of the page they deep-linked into. Executed once, red.
        expect(window.scrollTo).not.toHaveBeenCalled();
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
