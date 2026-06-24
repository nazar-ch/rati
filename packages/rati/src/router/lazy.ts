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
 */
export function lazy<T extends ComponentType<any>>(
    factory: () => Promise<{ default: T }>
): PreloadableLazyComponent<T> {
    let cached: Promise<{ default: T }> | undefined;
    const load = () => (cached ??= factory());

    const Component = reactLazy(load) as PreloadableLazyComponent<T>;
    Component.preload = load;
    return Component;
}
