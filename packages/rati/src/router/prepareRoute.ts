import {
    toRouterStore,
    type AnyRouter,
    type RouterStore,
    type RouterHydratedState,
} from './store.js';

/**
 * The server's routing decision: {@link hydratedState} rides the SSR HTML back to the
 * client's `RouterOptions.hydratedState`, so the first client render matches with no
 * routing gap; {@link matchedCatchAll} and {@link redirect} say what the response is.
 */
export interface PreparedRoute {
    hydratedState: RouterHydratedState;
    /** True when only the `*` catch-all matched — map it to a 404 status. */
    matchedCatchAll: boolean;
    /**
     * Present when a route-level `redirect` was followed during matching: respond
     * 301/302 (per `permanent`) with `to` instead of rendering. `hydratedState` then
     * describes the redirect TARGET — usable if the server renders it anyway.
     * `permanent` is true only when every followed hop was permanent.
     */
    redirect?: { to: string; permanent: boolean };
    /**
     * The matched route's own module, as the client build's manifest keys it — only for a
     * `lazy()` route built through `rati/vite`. The server turns it into the chunk's
     * `modulepreload`.
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
 * Drives a memory-history router to its matched route, preloading a `lazy()` component, and
 * snapshots its routing state for hydration. `null` when nothing matches or a followed
 * redirect left the table — check `router.redirectHops` before a 404 ({@link redirectFromHops}).
 */
export async function prepareRoute(publicRouter: AnyRouter): Promise<PreparedRoute | null> {
    const router = toRouterStore(publicRouter);
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
