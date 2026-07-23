import React, {
    type ComponentType,
    type FC,
    type ReactNode,
    Suspense,
    useDeferredValue,
} from 'react';
import { useRouter } from '../stores/RootStore';
import { navTrace } from '../util/navTrace';

export const Router: FC<{
    // router: RouterStore<any[] | readonly any[]>;
    /** Wrapper for routes that set none. Handed the route's element as `children`. */
    DefaultWrapper?: ComponentType<{ children: ReactNode }>;
    Loading?: ComponentType;
}> = ({ DefaultWrapper = EmptyWrapper, Loading = DefaultLoading }) => {
    // TODO: make this work with react native router too
    const router = useRouter();

    // Defer the active route so that a navigation to a still-loading lazy
    // route keeps showing the previous page instead of flashing the Suspense
    // fallback. useRouter reads via useSyncExternalStore, so startTransition
    // wouldn't take effect here — useDeferredValue does.
    const activeRoute = useDeferredValue(router.activeRoute);

    // The deferred value lags `router.activeRoute` by one low-priority render. The
    // gap between `setPath` and this mark showing the *new* route name is the
    // useDeferredValue deferral — a large gap means the old page lingered.
    navTrace(`Router render → ${activeRoute?.name ?? 'none'} (deferred)`);

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
