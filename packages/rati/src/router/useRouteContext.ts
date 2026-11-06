import type {
    UserRoutes,
    GenericRouteType,
    RouteContextNames,
    RouteContextValueOf,
} from './route.js';
import { useRouterStore } from './RouterProvider.js';

import { useScopeRead } from '../mandala/channel.js';

// Context-bearing route names off `RatiUserTypes['routes']`, the source `Link`'s `to` reads.
// Without an augmentation, as in rati's own tests, the hook stays usable and returns `unknown`.
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
            `useRouteContext('${name}'): the '${name}' route has no scope — no context to read.`,
        );
    }
    return route.scope;
}

/**
 * Reads the value a route's scope provides by route `name`, with no island module to
 * import: the name resolves the scope off the live routes table. Typed off
 * `RatiUserTypes['routes']`, accepting only scope-carrying names; `unknown` without it.
 */
export function useRouteContext<Name extends RouteContextName>(name: Name): RouteContextOf<Name> {
    const router = useRouterStore();
    const read = useScopeRead(scopeForRoute(router.routes, name as string));
    switch (read.status) {
        case 'value':
            return read.value as RouteContextOf<Name>;
        case 'no-provider':
            throw new Error(
                `useRouteContext('${name}'): the '${name}' route's island is not above the current ` +
                    `component — read it only inside that route's subtree.`,
            );
        case 'no-island':
            throw new Error(
                `useRouteContext('${name}'): the '${name}' route's scope is not wired to an island.`,
            );
    }
}
