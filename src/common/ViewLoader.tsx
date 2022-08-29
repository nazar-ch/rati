import _ from 'lodash';
import { observer } from 'mobx-react-lite';
import React, { FC, ReactElement, useRef } from 'react';
import { GenericView, View, ViewClassForView, ViewComponent } from '../stores/View';

export const ViewLoader: GenericViewLoaderComponent<{
    Loading: FC;
    // TODO: support this with ErrorBoundary, add "retry" link in errors for some of them
    error?: FC;
}> = observer(({ Component, view: viewClass, params, stores, Loading }) => {
    const viewRef = useRef<View<any> | null>(null);
    const paramsRef = useRef<Record<string, unknown> | null>(null);

    if (!_.isEqual(paramsRef.current, params)) {
        paramsRef.current = params;
        viewRef.current = viewClass.create(params, stores);
    }

    if (viewRef.current?.props) {
        return <Component {...(viewRef.current.props as any)} />;
    } else {
        // TODO: display this only after delay?
        return <Loading />;
    }
});
// Type for custom components based on ViewLoader (e. g. to have defined loading state)

export type ViewLoaderComponent = GenericViewLoaderComponent<{}>;
type GenericViewLoaderComponent<Props extends {}> = <
    TView extends GenericView,
    TParams extends {},
    TParentStores extends {}
>(
    props: {
        view: ViewClassForView<TView, TParams, TParentStores>;
        params: TParams;
        stores: TParentStores;
        Component: ViewComponent<TView>;
    } & Props
) => ReactElement<any, any> | null;
