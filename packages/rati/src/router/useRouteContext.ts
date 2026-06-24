import { useScopeRead } from '../mandala/channel';
import { useWebRouter } from '../stores/RootStore';
import type {
    UserRoutes,
    GenericRouteType,
    RouteContextNames,
    RouteContextValueOf,
} from './route';

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

// Resolve the scope a named route's island was built from, off the live routes table.
// Kept out of the hook body (throwing a clear error on a bad/scope-less name) so the
// hook stays unconditional — rules-of-hooks safe.
function scopeForRoute(routes: readonly GenericRouteType[], name: string): object {
    const route = routes.find((r) => r.name === name);
    if (!route) {
        throw new Error(`useRouteContext('${name}'): no route named '${name}'.`);
    }
    if (!route.scope) {
        throw new Error(
            `useRouteContext('${name}'): the '${name}' route has no scope — no context to read.`
        );
    }
    return route.scope;
}

/**
 * Read the value a route's scope provides (`.provide()`, else its resolved props) by the
 * route `name` — the no-import convenience for routes. `route` builds the island from
 * the route's scope, so there is no island module to reference; the `name` resolves the
 * scope off the live routes table, and the value is read through that scope's channel.
 *
 * The return type is read off the app's routes table (`RatiUserTypes['routes']`) by
 * name — `useRouteContext('page')` is typed with no type argument, and only
 * context-bearing (scope-carrying) route names are accepted. The same augmentation
 * `Link` relies on; no separate registration. Falls back to `unknown` when the app
 * hasn't augmented its routes.
 */
export function useRouteContext<Name extends RouteContextName>(name: Name): RouteContextOf<Name> {
    const router = useWebRouter();
    const read = useScopeRead(scopeForRoute(router.routes, name as string));
    switch (read.status) {
        case 'value':
            return read.value as RouteContextOf<Name>;
        case 'no-provider':
            throw new Error(
                `useRouteContext('${name}'): the '${name}' route's island is not above the current ` +
                    `component — read it only inside that route's subtree.`
            );
        case 'no-island':
            throw new Error(
                `useRouteContext('${name}'): the '${name}' route's scope is not wired to an island.`
            );
    }
}
