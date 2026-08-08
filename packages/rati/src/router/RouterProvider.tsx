import React, { useContext, useSyncExternalStore } from 'react';

import type { Router } from './router';
import { RouterStore, type AnyRouter } from './store';

/*
    The router's own React plumbing: `RouterProvider` puts the app's router (built by
    `createRouter`) into context; `useRouter` reads and subscribes to it. This is the
    whole delivery mechanism — the router is not a member of some framework-owned stores
    container (rati has none; app store graphs are app code).
*/

const RouterContext = React.createContext<RouterStore | null>(null);

/**
 * Provide the app's router to the tree. Wrap everything that navigates or reads the
 * router — including shells above `<RouterOutlet/>` — in one of these:
 *
 * ```tsx
 * const router = createRouter(routes);
 * <RouterProvider router={router}>
 *     <AppShell>
 *         <RouterOutlet />
 *     </AppShell>
 * </RouterProvider>
 * ```
 */
export function RouterProvider({
    router,
    children,
}: {
    router: AnyRouter;
    children: React.ReactNode;
}) {
    if (!(router instanceof RouterStore)) {
        // The interface is the public face, but the plumbing (RouterOutlet's render
        // fields, subscribe/getSnapshot identity) needs the real thing — refuse a
        // hand-rolled object here, where the mistake is visible.
        throw new Error('[rati] RouterProvider: `router` must be built by createRouter().');
    }
    return <RouterContext.Provider value={router}>{children}</RouterContext.Provider>;
}

const noopSubscribe = () => () => {};
const noopGetSnapshot = () => 0;

/**
 * The concrete store, for rati's own internals (`RouterOutlet` needs the matched
 * component; `Link` builds hrefs over any table). Subscribes like {@link useRouter}.
 * @internal
 */
export function useRouterStore(): RouterStore {
    const router = useContext(RouterContext);

    // Subscribe so any component reading the router (Link, RouterOutlet, app code)
    // re-renders on navigation. A no-op subscription when no router is provided keeps
    // the rules of hooks intact; the throw below turns that into a clear error.
    useSyncExternalStore(
        router?.subscribe ?? noopSubscribe,
        router?.getSnapshot ?? noopGetSnapshot,
        router?.getSnapshot ?? noopGetSnapshot,
    );

    if (!router) {
        throw new Error(
            '[rati] useRouter: no router in context — wrap the app in <RouterProvider router={…}>.',
        );
    }

    return router;
}

/**
 * Read the app's router and subscribe to it, so a component that navigates or reads
 * `activeRoute` / `path` re-renders on navigation. This is the public way to reach the
 * router programmatically — `Link`, `RouterOutlet`, and app code all go through this
 * context. Throws when no `<RouterProvider>` is above.
 */
export function useRouter(): Router {
    // Same widening as createRouter's: the context holds the table-generic store, the
    // public face speaks the augmentation's types.
    return useRouterStore() as Router;
}
