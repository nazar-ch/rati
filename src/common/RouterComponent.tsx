import React, { ComponentType, FC } from 'react';
import { observer } from 'mobx-react-lite';
import { WebRouter } from '../stores/WebRouter';
import { ViewLoader as GenericViewLoader } from './ViewLoader';

export const RouterComponent: FC<{
    router: WebRouter<any[] | readonly any[]>;
    DefaultWrapper?: ComponentType;
    ViewLoader?: typeof GenericViewLoader;
    Loading?: ComponentType;
}> = observer(({ DefaultWrapper = EmptyWrapper, ViewLoader = GenericViewLoader, Loading = () => <>
            loading...
        </>, router }) => {
    const { activeRoute } = router;

    if (!activeRoute) {
        return null;
    }

    const Wrapper = activeRoute.wrapperComponent ?? DefaultWrapper;

    return (
        <Wrapper>
            <ViewLoader
                Component={activeRoute.component}
                view={activeRoute.view}
                params={{
                    routeParams: activeRoute.routeParams,
                }}
                stores={{}}
                Loading={Loading}
                // Rerender when the route changes
                key={activeRoute.path}
            />
        </Wrapper>
    );
});

export const EmptyWrapper: FC = ({ children }) => <>{children}</>;
