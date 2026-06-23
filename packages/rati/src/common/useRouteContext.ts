import { useScope, type IslandComponent } from '../experimental/island';
import { useWebRouter } from '../stores/RootStore';
import type { UserRoutes, RouteContextNames, RouteContextValueOf } from '../stores/WebRouterStore';

// Context-bearing route names, derived from the app's routes table
// (`RatiUserTypes['routes']`) — the same source `Link`'s `to` reads, so the context
// type comes from the route definitions with no separate registration. Falls back to
// `string` when the app hasn't augmented its routes (e.g. rati's own tests), keeping
// the hook usable (returning `unknown`).
type ContextName = [UserRoutes] extends [never] ? never : RouteContextNames<UserRoutes>;
type RouteContextName = [ContextName] extends [never] ? string : ContextName;

// The context type a route name provides (its scope's `.provide()` value, else the
// resolved props), or `unknown` when the app hasn't augmented its routes.
type RouteContextOf<Name extends RouteContextName> = [UserRoutes] extends [never]
    ? unknown
    : RouteContextValueOf<UserRoutes, Name & string>;

// Resolve the island a named route built off the live routes table. Kept out of
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
 * Read the value a route's scope provides (`.provide()`) by its `name`, without
 * importing the island component to hand to `useScope`. Because `route` builds the
 * island from the route's `scope`, there is no island module to import; the `name`
 * resolves it off the live routes table — the very island object that keys the
 * value channel. So a route's subtree reads its provided value without depending on
 * the island's identity (which `route` doesn't export).
 *
 * The return type is read off the app's routes table (`RatiUserTypes['routes']`) by
 * name — `useRouteContext('page')` is typed with no type argument, and only
 * context-bearing (scope-carrying) route names are accepted. The same augmentation
 * `Link` relies on; no separate registration. Falls back to `unknown` when the app
 * hasn't augmented its routes.
 */
export function useRouteContext<Name extends RouteContextName>(name: Name): RouteContextOf<Name> {
    const router = useWebRouter();
    return useScope(islandForRoute(router.routes, name as string)) as RouteContextOf<Name>;
}
