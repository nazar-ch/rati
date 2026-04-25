import { resolveView } from './view';
import type { WebRouterStore, WebRouterHydratedState } from '../stores/WebRouterStore';

/**
 * The result of preparing a route on the server. The {@link hydratedState}
 * snapshot can be embedded in the SSR HTML response and passed back to the
 * client as `WebRouterStoreOptions.hydratedState`, so the first client render
 * matches the server HTML without an async resolution gap.
 */
export interface PreparedRoute {
    hydratedState: WebRouterHydratedState;
}

/**
 * Drive a memory-history-backed router to a fully resolved active route, then
 * snapshot its state for client hydration.
 *
 * Steps:
 * 1. Wait for the router's pending `setPath` (kicked off by the constructor)
 *    to populate `activeRoute`.
 * 2. If the matched component was created via `lazy()`, call its `preload()`
 *    so React.lazy doesn't throw during `renderToString` with no fallback to
 *    show.
 * 3. If the route has a `view`, run `resolveView` against the route params
 *    and capture the resolved props for hydration.
 *
 * Returns `null` when no route matches (typically a routing table without a
 * wildcard catch-all). Callers can treat that as a 404 and render their own
 * not-found response.
 */
export async function prepareRoute(
    router: WebRouterStore<any>
): Promise<PreparedRoute | null> {
    await router.pendingNavigation;

    const route = router.activeRoute;
    if (!route) return null;

    const preload = (route.component as { preload?: () => Promise<unknown> }).preload;
    if (typeof preload === 'function') {
        await preload();
    }

    let viewProps: Record<string, unknown> | undefined;
    if (route.view) {
        viewProps = (await resolveView(route.view, route.routeParams as any)) as Record<
            string,
            unknown
        >;
    }

    return {
        hydratedState: {
            path: router.path,
            search: router.search,
            hash: router.hash,
            activeRouteName: route.name,
            routeParams: route.routeParams,
            viewProps,
        },
    };
}
