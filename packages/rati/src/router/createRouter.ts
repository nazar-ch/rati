import type { GenericRouteType } from './route.js';
import type { Router } from './router.js';
import { RouterStore, type RouterOptions } from './store.js';

/**
 * Builds the app's router over its route table — one per app on the client, one per request
 * on the server with a memory `history` — for `<RouterProvider>`. Returns the table-blind
 * {@link Router}, typed off the `RatiUserTypes` augmentation.
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
