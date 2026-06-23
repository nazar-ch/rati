import type { WebRouterStore, WebRouterHydratedState } from '../stores/WebRouterStore';

/**
 * The result of preparing a route on the server. The {@link hydratedState}
 * snapshot can be embedded in the SSR HTML response and passed back to the
 * client as `WebRouterStoreOptions.hydratedState`, so the first client render
 * matches the server HTML without an async routing gap.
 */
export interface PreparedRoute {
    hydratedState: WebRouterHydratedState;
}

/**
 * Drive a memory-history-backed router to its matched active route, then snapshot
 * its routing state for client hydration.
 *
 * Steps:
 * 1. Wait for the router's pending `setPath` (kicked off by the constructor) to
 *    populate `activeRoute`.
 * 2. If the matched component was created via `lazy()`, call its `preload()` so
 *    React.lazy doesn't throw during the server render with no fallback to show.
 *
 * Returns `null` when no route matches (typically a routing table without a
 * wildcard catch-all). Callers can treat that as a 404.
 *
 * View *data* is not resolved here — a route's view is an island that resolves at
 * render time, so a Suspense-awaiting server render (`react-dom/static`
 * `prerender`) resolves it and the island engine dehydrates the promise values
 * (see `IslandHydrationProvider`). This builds only the routing snapshot.
 */
export async function prepareRoute(router: WebRouterStore<any>): Promise<PreparedRoute | null> {
    await router.pendingNavigation;

    const route = router.activeRoute;
    if (!route) return null;

    const preload = (route.component as { preload?: () => Promise<unknown> }).preload;
    if (typeof preload === 'function') {
        await preload();
    }

    return {
        hydratedState: {
            path: router.path,
            search: router.search,
            hash: router.hash,
            activeRouteName: route.name,
            routeParams: route.routeParams,
        },
    };
}
