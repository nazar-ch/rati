import React, { ComponentType, FC } from 'react';
import { observer } from 'mobx-react-lite';
import { WebRouter } from '../stores/WebRouter';
import { ViewLoader } from './ViewLoader';

export const RouterComponent: FC<{
    router: WebRouter<any[] | readonly any[]>;
    DefaultWrapper?: ComponentType;
    Loader?: typeof ViewLoader;
}> = observer(({ DefaultWrapper = EmptyWrapper, Loader = ViewLoader, router }) => {
    const { activeRoute } = router;

    if (!activeRoute) {
        return null;
    }

    const Wrapper = activeRoute.wrapperComponent ?? DefaultWrapper;

    return (
        <Wrapper>
            <Loader
                Component={activeRoute.component}
                view={activeRoute.view}
                params={{
                    routeParams: activeRoute.routeParams,
                }}
                stores={{}}
                Loading={() => <>loading...</>}
                // Rerender when the route changes
                key={activeRoute.path}
            />
        </Wrapper>
    );
});

export const EmptyWrapper: FC = ({ children }) => <>{children}</>;
