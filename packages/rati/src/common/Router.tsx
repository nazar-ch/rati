import React, { type ComponentType, type FC, Suspense, useDeferredValue } from 'react';
import { observer } from 'mobx-react-lite';
import { useWebRouter } from '../stores/RootStore';

export const Router: FC<{
    // router: WebRouterStore<any[] | readonly any[]>;
    DefaultWrapper?: ComponentType;
    Loading?: ComponentType;
}> = observer(({ DefaultWrapper = EmptyWrapper, Loading = DefaultLoading }) => {
    // TODO: make this work with react native router too
    const router = useWebRouter();

    // Defer the active route so that a navigation to a still-loading lazy
    // route keeps showing the previous page instead of flashing the Suspense
    // fallback. mobx-react-lite reads via useSyncExternalStore, so
    // startTransition wouldn't take effect here — useDeferredValue does.
    const activeRoute = useDeferredValue(router.activeRoute);

    if (!activeRoute) {
        return null;
    }

    const Wrapper = activeRoute.wrapperComponent ?? DefaultWrapper;

    // A route's component is either a plain component or an island (built by
    // `route({ view })` / `createIsland`); both render directly with the route
    // params. An island owns its own loading/error slots and data resolution; the
    // Suspense here is for a `lazy()` route component while its chunk imports
    // (eager components never suspend, so it's a no-op for them).
    return (
        <Wrapper>
            <Suspense fallback={<Loading />}>
                <activeRoute.component
                    {...activeRoute.routeParams}
                    // Rerender when the route changes
                    key={activeRoute.pathCounter}
                />
            </Suspense>
        </Wrapper>
    );
});

const DefaultLoading: FC = () => <>loading...</>;

export const EmptyWrapper: FC<{ children: React.ReactNode }> = ({ children }) => <>{children}</>;
