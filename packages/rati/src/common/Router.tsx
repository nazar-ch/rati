import React, { ComponentType, FC, Suspense, useDeferredValue } from 'react';
import { observer } from 'mobx-react-lite';
import { ViewLoader as GenericViewLoader } from './ViewLoader';
import { useWebRouter } from '../stores/RootStore';

export const Router: FC<{
    // router: WebRouterStore<any[] | readonly any[]>;
    DefaultWrapper?: ComponentType;
    ViewLoader?: typeof GenericViewLoader;
    Loading?: ComponentType;
}> = observer(
    ({
        DefaultWrapper = EmptyWrapper,
        ViewLoader = GenericViewLoader,
        Loading = DefaultLoading,
    }) => {
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

        if (!activeRoute.view) {
            return (
                <Wrapper>
                    {/*
                  Suspense lets `route()` accept React.lazy components: while
                  the chunk imports, the Loading fallback renders. Eager
                  components never suspend, so this is a no-op for them.
                */}
                    <Suspense fallback={<Loading />}>
                        <activeRoute.component
                            {...activeRoute.routeParams}
                            // Rerender when the route changes
                            key={activeRoute.pathCounter}
                        />
                    </Suspense>
                </Wrapper>
            );
        }

        return (
            <Wrapper>
                <Suspense fallback={<Loading />}>
                    <ViewLoader
                        Component={activeRoute.component}
                        view={activeRoute.view}
                        params={activeRoute.routeParams}
                        Loading={Loading}
                        initialViewProps={activeRoute.hydratedViewProps}
                        // Rerender when the route changes
                        key={activeRoute.pathCounter}
                    />
                </Suspense>
            </Wrapper>
        );
    }
);

const DefaultLoading: FC = () => <>loading...</>;

export const EmptyWrapper: FC<{ children: React.ReactNode }> = ({ children }) => <>{children}</>;
