/**
 * SPA scroll restoration, which the browser does only for full-document loads: PUSH/REPLACE
 * scroll to the top or the `#anchor`, and POP restores the entry's position, kept in memory.
 */

import type { History } from './history.js';

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
    options: ScrollRestorationOptions = {},
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

        // A double rAF, one full frame, lets React's synchronous renders flush. A route
        // waiting on async island data renders later, so its restored position clamps to the
        // pre-render height and an anchor can miss.
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
    scrollToTop: () => void,
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
