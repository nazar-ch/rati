import type { GenericRouteType } from './route.js';
import type { Router } from './router.js';
import { RouterStore, type RouterOptions } from './store.js';

/**
 * Build the app's router over its route table. Construct one per app on the client, one
 * per request on the server (with a memory `history`), then hand it to
 * `<RouterProvider router={…}>`.
 *
 * The return type is {@link Router} — table-blind, with navigation targets and
 * `activeRoute` typed from the `RatiUserTypes` augmentation — so the value can be held
 * anywhere (a store container included) without dragging the route table's component
 * types along. No type parameter: the augmentation is the single source of route typing.
 */
export function createRouter(
    routes: readonly GenericRouteType[],
    options: RouterOptions = {},
): Router {
    // The store is table-generic — the framework never sees the app's table type, while
    // `Router` speaks the augmentation's. This mint point is where the two meet, and the
    // one place the widening cast is sanctioned: the routes passed here are the same
    // table the augmentation registered.
    return new RouterStore(routes, options) as Router;
}
