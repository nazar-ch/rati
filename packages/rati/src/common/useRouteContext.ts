import { useIslandContext, type IslandComponent } from '../experimental/island';
import { useWebRouter } from '../stores/RootStore';
import type { RatiRouteContexts } from '../stores/WebRouterStore';

// Context-bearing route names — the keys an app registers in `RatiRouteContexts`.
// Falls back to `string` when none are registered, so the hook stays usable
// (returning `unknown`) without the augmentation — e.g. in rati's own tests.
type RegisteredName = keyof RatiRouteContexts & string;
type RouteContextName = [RegisteredName] extends [never] ? string : RegisteredName;

// The context type registered for a route name, or `unknown` for an unregistered
// (string-fallback) name.
type RouteContextOf<Name extends RouteContextName> = Name extends keyof RatiRouteContexts
    ? RatiRouteContexts[Name]
    : unknown;

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
 * Read the island-owned context (`.context()`) of a route by its `name`, without
 * importing the island component to hand to `useIslandContext`. Because `route`
 * builds the island from the route's `view`, there is no island module to import;
 * the `name` resolves it off the live routes table — the very island object that
 * keys the context channel. So a route's subtree reads its context without
 * depending on the island's identity (which `route` doesn't export).
 *
 * The return type comes from the app's {@link RatiRouteContexts} augmentation —
 * `useRouteContext('page')` is typed with no type argument. Names the app hasn't
 * registered fall back to `unknown`.
 */
export function useRouteContext<Name extends RouteContextName>(name: Name): RouteContextOf<Name> {
    const router = useWebRouter();
    return useIslandContext(islandForRoute(router.routes, name as string)) as RouteContextOf<Name>;
}
