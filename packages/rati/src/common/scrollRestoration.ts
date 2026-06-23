/**
 * SPA scroll restoration. The browser only restores scroll for full-document
 * loads, not for `pushState` navigation, so we have to do it ourselves.
 *
 * Behavior:
 * - `PUSH`/`REPLACE`: scroll to top (or to `#anchor` if the URL has one).
 * - `POP` (back/forward): restore the position the user was at when they
 *   last left this entry.
 *
 * Caveats:
 * - Restoration fires on the next paint, which is correct for routes that
 *   render synchronously. Routes that wait on async data (an island scope
 *   resolving) render later — the restored scroll position will be clamped
 *   against the pre-render content height. Anchor lookup may also miss elements
 *   not yet in the DOM. Both are acceptable defaults; tying restoration to async
 *   data-loading boundaries is a future enhancement.
 * - Saved positions live in memory for the session. They are not persisted
 *   across reloads.
 */

import type { History } from './history';

export interface ScrollRestorationOptions {
    /**
     * Override the default "scroll to top" target on PUSH/REPLACE. Useful
     * when the app has a fixed header and you want to scroll the main
     * content container instead of the window.
     */
    scrollToTop?: () => void;
}

export function installScrollRestoration(
    history: History,
    options: ScrollRestorationOptions = {}
): () => void {
    if (typeof window === 'undefined') return () => {};

    const previousMode = window.history.scrollRestoration;
    window.history.scrollRestoration = 'manual';

    const positions = new Map<string, { x: number; y: number }>();
    let previousKey = history.location.key;

    const scrollToTop = options.scrollToTop ?? (() => window.scrollTo(0, 0));

    const unsubscribe = history.listen(({ location, action }) => {
        // Save the position of the entry we're leaving. The window hasn't
        // re-rendered yet at this point, so the current scroll is still the
        // outgoing entry's position.
        positions.set(previousKey, { x: window.scrollX, y: window.scrollY });
        previousKey = location.key;

        // Defer the restore until the new route has had a chance to commit.
        // A double rAF lands one full frame later — long enough for React's
        // synchronous renders to flush. Async island scopes will render after
        // this fires; that's the documented caveat above.
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                applyScroll(action, location, positions, scrollToTop);
            });
        });
    });

    return () => {
        unsubscribe();
        window.history.scrollRestoration = previousMode;
    };
}

function applyScroll(
    action: 'PUSH' | 'REPLACE' | 'POP',
    location: { hash: string; key: string },
    positions: Map<string, { x: number; y: number }>,
    scrollToTop: () => void
) {
    if (action === 'POP') {
        const saved = positions.get(location.key);
        if (saved) {
            window.scrollTo(saved.x, saved.y);
            return;
        }
        // Fresh entry the user reached via back/forward but never visited in
        // this session — fall through to the PUSH behavior.
    }

    if (location.hash) {
        const id = decodeURIComponent(location.hash.slice(1));
        const el = document.getElementById(id);
        if (el) {
            el.scrollIntoView();
            return;
        }
    }

    scrollToTop();
}
