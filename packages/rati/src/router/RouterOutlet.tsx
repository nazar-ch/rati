import React, {
    type ComponentType,
    type FC,
    type ReactNode,
    Suspense,
    useDeferredValue,
} from 'react';

import { useRouterStore } from './RouterProvider.js';

import { navTrace } from '../util/navTrace.js';

/**
 * The outlet — renders the active route (its wrapper, then the route component under a
 * Suspense for `lazy()` chunks). Render exactly one, anywhere under `<RouterProvider>`.
 */
export const RouterOutlet: FC<{
    /** Wrapper for routes that set none. Handed the route's element as `children`. */
    DefaultWrapper?: ComponentType<{ children: ReactNode }>;
    Loading?: ComponentType;
}> = ({ DefaultWrapper = EmptyWrapper, Loading = DefaultLoading }) => {
    const router = useRouterStore();

    // Defer the active route so that a navigation to a still-loading lazy
    // route keeps showing the previous page instead of flashing the Suspense
    // fallback. useRouterStore reads via useSyncExternalStore, so startTransition
    // wouldn't take effect here — useDeferredValue does.
    const activeRoute = useDeferredValue(router.activeRoute);

    // The deferred value lags `router.activeRoute` by one low-priority render. The
    // gap between `setPath` and this mark showing the NEW route name is the
    // useDeferredValue deferral — a large gap means the old page lingered.
    navTrace(`RouterOutlet render → ${activeRoute?.name ?? 'none'} (deferred)`);

    if (!activeRoute) {
        return null;
    }

    const Wrapper = activeRoute.wrapperComponent ?? DefaultWrapper;

    // Remounts the route component on every navigation, keyed by a per-navigation counter.
    // An island keeping its previous run (`keepStale`, `loadingDelayMs`) keys by route name
    // instead: what it keeps lives on the instance, and a same-route param change re-renders it.
    const keepsRun = (activeRoute.component as { keepsRun?: boolean }).keepsRun === true;
    const routeKey = keepsRun ? `route:${activeRoute.name}` : activeRoute.pathCounter;

    // A route's component, plain or an island, renders directly with the route params; the
    // Suspense is for a `lazy()` route component while its chunk imports.
    return (
        <Wrapper>
            <Suspense fallback={<Loading />}>
                <activeRoute.component {...activeRoute.routeParams} key={routeKey} />
            </Suspense>
        </Wrapper>
    );
};

const DefaultLoading: FC = () => <>loading...</>;

export const EmptyWrapper: FC<{ children: React.ReactNode }> = ({ children }) => <>{children}</>;
