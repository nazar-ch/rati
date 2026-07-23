import { lazy as reactLazy, type ComponentType, type LazyExoticComponent } from 'react';

/**
 * A `React.lazy` component that also exposes a `preload()` method to fetch
 * its chunk ahead of render. Returned by {@link lazy}.
 */
export type PreloadableLazyComponent<T extends ComponentType<any>> = LazyExoticComponent<T> & {
    /**
     * Trigger the dynamic import without rendering. Safe to call multiple
     * times — the underlying promise is shared with the lazy render path,
     * so a subsequent render will reuse the cached chunk.
     */
    preload(): Promise<{ default: T }>;
    /**
     * Which module this component imports, as the client build's manifest keys it
     * (`src/pages/Settings.tsx`) — written by `rati/vite`'s transform, absent
     * otherwise. The server reads it off the matched route to preload the route's
     * chunk alongside the HTML; see `prepareRoute`.
     */
    moduleId?: string;
};

/**
 * Like `React.lazy`, but the returned component carries a `preload()` method.
 * Pair with `<Link prefetch>` (or any hover/intent signal) to start the
 * import before the user actually navigates.
 *
 * ```ts
 * const ProductPage = lazy(() => import('./ProductPage'));
 * route('/products/:id', 'product', ProductPage);
 *
 * // Elsewhere:
 * ProductPage.preload(); // begin fetching the chunk early
 * ```
 *
 * You never write {@link moduleId}: the `rati/vite` plugin's transform appends it at
 * each call site, so a server render can name the route's client chunk. Without the
 * plugin it stays undefined and nothing else changes.
 */
export function lazy<T extends ComponentType<any>>(
    factory: () => Promise<{ default: T }>,
    moduleId?: string,
): PreloadableLazyComponent<T> {
    let cached: Promise<{ default: T }> | undefined;
    const load = () => (cached ??= factory());

    const Component = reactLazy(load) as PreloadableLazyComponent<T>;
    Component.preload = load;
    if (moduleId !== undefined) Component.moduleId = moduleId;
    return Component;
}
