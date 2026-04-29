/**
 * Navigation API interceptor — progressive enhancement for browsers that
 * support `window.navigation` (Chrome 102+, Safari 18+).
 *
 * When available, the browser fires `navigate` for every link click,
 * `history.back/forward`, and form submission — including modifier-key
 * combos, `target` handling, downloads, and cross-origin checks already
 * resolved by the platform.
 *
 * In browsers without it (Firefox as of early 2026), the `<Link>` component
 * keeps its own click handler. `isNavigationApiAvailable()` lets the link
 * skip work that the platform will do.
 */

export interface NavigationInterception {
    /** A native URL the link clicked, or programmatic navigation target. */
    url: URL;
    /** State value passed by the navigator, if any. */
    state: unknown;
}

interface NavigateEventLike {
    canIntercept: boolean;
    hashChange: boolean;
    downloadRequest: string | null;
    formData: unknown;
    destination: { url: string; getState(): unknown };
    intercept(opts: { handler: () => Promise<void> | void }): void;
}

interface NavigationLike {
    addEventListener(type: 'navigate', listener: (event: NavigateEventLike) => void): void;
    removeEventListener(type: 'navigate', listener: (event: NavigateEventLike) => void): void;
}

export function isNavigationApiAvailable(): boolean {
    return typeof window !== 'undefined' && 'navigation' in window;
}

/**
 * Subscribe to browser-level navigations. The handler receives the resolved
 * destination URL; the browser has already updated `window.location` when it
 * runs. Returns an unsubscribe function. No-op (returns noop) if the
 * Navigation API is not available.
 */
export function interceptNavigations(
    handler: (intercepted: NavigationInterception) => Promise<void> | void
): () => void {
    if (!isNavigationApiAvailable()) {
        return () => {};
    }

    const navigation = (window as unknown as { navigation: NavigationLike }).navigation;

    const listener = (event: NavigateEventLike) => {
        // Skip everything the platform tells us not to handle:
        // - cross-document navigations we can't intercept (e.g. cross-origin),
        // - in-page hash anchors,
        // - `download` link clicks,
        // - form posts (handled separately if/when forms become a concern).
        if (
            !event.canIntercept ||
            event.hashChange ||
            event.downloadRequest !== null ||
            event.formData
        ) {
            return;
        }

        const url = new URL(event.destination.url);
        if (url.origin !== window.location.origin) return;

        event.intercept({
            handler: async () => {
                await handler({ url, state: event.destination.getState() });
            },
        });
    };

    navigation.addEventListener('navigate', listener);
    return () => navigation.removeEventListener('navigate', listener);
}

/**
 * For hash-mode history: extract the route portion from a full URL by reading
 * its hash. Returns `null` if the URL has no hash (a real same-origin link
 * outside of hash routing — which we shouldn't try to handle).
 */
export function hashHistoryPathFromUrl(url: URL): string | null {
    if (!url.hash) return null;
    return url.hash.slice(1) || '/';
}
