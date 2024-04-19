import React, { ComponentType, FC } from 'react';
import { observer } from 'mobx-react-lite';
import { ViewLoader as GenericViewLoader } from './ViewLoader';
import { useWebRouter } from '../stores/RootStore';

export const Router: FC<{
    // router: WebRouterStore<any[] | readonly any[]>;
    DefaultWrapper?: ComponentType;
    ViewLoader?: typeof GenericViewLoader;
    Loading?: ComponentType;
}> = observer(({ DefaultWrapper = EmptyWrapper, ViewLoader = GenericViewLoader, Loading = () => <>
            loading...
</> }) => {
    // TODO: make this work with react native router too
    const router = useWebRouter();

    const { activeRoute } = router;

    if (!activeRoute) {
        return null;
    }

    const Wrapper = activeRoute.wrapperComponent ?? DefaultWrapper;

    if (!activeRoute.view) {
        return (
            <Wrapper>
                <activeRoute.component
                    {...activeRoute.routeParams}
                    // Rerender when the route changes
                    key={activeRoute.path}
                />
            </Wrapper>
        );
    }

    return (
        <Wrapper>
            <ViewLoader
                Component={activeRoute.component}
                view={activeRoute.view}
                params={activeRoute.routeParams}
                Loading={Loading}
                // Rerender when the route changes
                key={activeRoute.path}
            />
        </Wrapper>
    );
});

export const EmptyWrapper: FC<{ children: React.ReactNode }> = ({ children }) => <>{children}</>;
