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
    // gap between `setPath` and this mark showing the *new* route name is the
    // useDeferredValue deferral — a large gap means the old page lingered.
    navTrace(`RouterOutlet render → ${activeRoute?.name ?? 'none'} (deferred)`);

    if (!activeRoute) {
        return null;
    }

    const Wrapper = activeRoute.wrapperComponent ?? DefaultWrapper;

    // Remount the route component on every navigation — the per-navigation counter is a
    // key nothing else can collide with, so a route's own state never leaks across one.
    //
    // An island that keeps its previous run across a re-resolve (`keepStale`, or
    // `loadingDelayMs` for the length of its window) is the exception, and has to be: what
    // it keeps lives on the island instance, so remounting it destroys exactly the thing
    // those options exist to preserve. Those key by route name instead, which still remounts
    // when the route changes and lets a same-route param change re-render the instance — the
    // mandala's own param-change path, which is where the kept run does its work. Opt-in, so
    // the default keying above is what every other route still gets.
    const keepsRun = (activeRoute.component as { keepsRun?: boolean }).keepsRun === true;
    const routeKey = keepsRun ? `route:${activeRoute.name}` : activeRoute.pathCounter;

    // A route's component is either a plain component or an island (built by
    // `route({ scope })` / `island`); both render directly with the route
    // params. An island owns its own loading/error slots and data resolution; the
    // Suspense here is for a `lazy()` route component while its chunk imports
    // (eager components never suspend, so it's a no-op for them).
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
