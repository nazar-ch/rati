import type { RouterStore, RouterHydratedState } from './store';

/**
 * The server's routing decision object. {@link hydratedState} is embedded in the SSR
 * HTML response and passed back to the client as `RouterStoreOptions.hydratedState`,
 * so the first client render matches the server HTML without an async routing gap;
 * {@link matchedCatchAll} and {@link redirect} carry what the response should be
 * before any rendering happens.
 */
export interface PreparedRoute {
    hydratedState: RouterHydratedState;
    /** True when only the `*` catch-all matched — map it to a 404 status. */
    matchedCatchAll: boolean;
    /**
     * Present when a route-level `redirect` was followed during matching: respond
     * 301/302 (per `permanent`) with `to` instead of rendering. `hydratedState` then
     * describes the redirect *target* — usable if the server renders it anyway.
     * `permanent` is true only when every followed hop was permanent.
     */
    redirect?: { to: string; permanent: boolean };
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
 * Scope *data* is not resolved here — a route's scope is an island that resolves at
 * render time, so a Suspense-awaiting server render (`react-dom/static`
 * `prerender`) resolves it and the mandala engine dehydrates the promise values
 * (see `HydrationProvider` in `rati/ssr`). This builds only the routing snapshot.
 */
export async function prepareRoute(router: RouterStore<any>): Promise<PreparedRoute | null> {
    await router.pendingNavigation;

    const route = router.activeRoute;
    if (!route) return null;

    const preload = (route.component as { preload?: () => Promise<unknown> }).preload;
    if (typeof preload === 'function') {
        await preload();
    }

    const hops = router.redirectHops;
    return {
        hydratedState: {
            path: router.path,
            search: router.search,
            hash: router.hash,
            activeRouteName: route.name,
            routeParams: route.routeParams,
        },
        matchedCatchAll: route.path === '*',
        ...(hops.length > 0
            ? {
                  redirect: {
                      to: hops[hops.length - 1]!.to,
                      permanent: hops.every((hop) => hop.permanent),
                  },
              }
            : {}),
    };
}
