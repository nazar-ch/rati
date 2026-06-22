import { useIslandContext, type IslandComponent } from '../experimental/island';
import { useWebRouter } from '../stores/RootStore';
import type { UserRoutes } from '../stores/WebRouterStore';

// Route names available to `useRouteContext`. Falls back to `string` when the app
// hasn't declared its routes via `RatiUserTypes` (e.g. rati's own tests), so the
// hook stays usable without the augmentation.
type RouteName = [UserRoutes] extends [never] ? string : UserRoutes[number]['name'] & string;

// Resolve the island a named route2 built off the live routes table. Kept out of
// the hook body (and throwing a clear error on a bad name there) so the two hooks
// in `useRouteContext` stay unconditional — rules-of-hooks safe.
function islandForRoute(
    routes: readonly { name: string; component: unknown }[],
    name: string
): IslandComponent<any> {
    const route = routes.find((r) => r.name === name);
    if (!route) {
        throw new Error(`useRouteContext: no route named "${name}"`);
    }
    return route.component as IslandComponent<any>;
}

/**
 * Read the island-owned context (`.context()`) of a route2 route by its `name`,
 * without importing the island component to hand to `useIslandContext`. Because
 * route2 builds the island from the route's `view`, there is no island module to
 * import; the `name` resolves it off the live routes table — the very island
 * object that keys the context channel. So a route's subtree reads its context
 * without depending on the island's identity (which route2 doesn't export).
 *
 * The context value type can't be recovered from the type-erased routes table, so
 * pass it as the type argument: `useRouteContext<PageContext>('page')`.
 */
export function useRouteContext<Context = unknown>(name: RouteName): Context {
    const router = useWebRouter();
    return useIslandContext(islandForRoute(router.routes, name)) as Context;
}
