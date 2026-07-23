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
    /**
     * The matched route's own module, as the client build's manifest keys it — present
     * only for a `lazy()` route built through `rati/vite` (which records it). The
     * server turns it into the route chunk's `modulepreload`, so the browser fetches
     * the chunk alongside the HTML instead of discovering it after hydration.
     */
    moduleId?: string;
}

/**
 * The 30x a followed redirect trail describes: the last hop's target, permanent only
 * when every hop along the way was. Shared with `renderApp`, which reads the hops off
 * the router when the trail ends outside the table and there is no `PreparedRoute` to
 * carry them.
 */
export function redirectFromHops(
    hops: RouterStore<any>['redirectHops'],
): { to: string; permanent: boolean } | undefined {
    if (hops.length === 0) return undefined;
    return { to: hops[hops.length - 1]!.to, permanent: hops.every((hop) => hop.permanent) };
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
 * wildcard catch-all). Callers can treat that as a 404 — but a null return can also
 * mean a followed redirect landed outside the table, where the hop stands and only
 * the route to describe is missing. Consult `router.redirectHops` before answering
 * 404 (`renderApp` does, via {@link redirectFromHops}).
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

    const lazyComponent = route.component as {
        preload?: () => Promise<unknown>;
        moduleId?: string;
    };
    if (typeof lazyComponent.preload === 'function') {
        await lazyComponent.preload();
    }

    const redirect = redirectFromHops(router.redirectHops);
    return {
        hydratedState: {
            path: router.path,
            search: router.search,
            hash: router.hash,
            activeRouteName: route.name,
            routeParams: route.routeParams,
        },
        matchedCatchAll: route.path === '*',
        ...(lazyComponent.moduleId !== undefined ? { moduleId: lazyComponent.moduleId } : {}),
        ...(redirect ? { redirect } : {}),
    };
}
