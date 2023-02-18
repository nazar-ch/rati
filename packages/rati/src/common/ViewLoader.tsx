import _ from 'lodash';
import { observer } from 'mobx-react-lite';
import React, { ComponentType, FC, ReactElement, useEffect, useRef, useState } from 'react';
import { resolveView, ViewComponent, CreateView, RequiredViewParams } from './view';

/* 
Previous version with Refs for reference

const LegacyViewLoader: LegacyGenericViewLoaderComponent<{
    Loading: ComponentType;
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


type LegacyViewLoaderComponent = LegacyGenericViewLoaderComponent<{}>;

type LegacyGenericViewLoaderComponent<Props extends {}> = <
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
*/

type GenericViewLoaderComponent<Props extends {}> = <TView extends CreateView<any>>(
    props: {
        view: TView;
        params: RequiredViewParams<TView>;
        Component: ViewComponent<TView>;
    } & Props
) => ReactElement<any, any> | null;

function usePrevious<T>(value: T) {
    const ref = useRef<T>();
    useEffect(() => {
        ref.current = value;
    });
    return ref.current;
}

export const ViewLoader: GenericViewLoaderComponent<{
    Loading: ComponentType;
    // TODO: support this with ErrorBoundary, add "retry" link in errors for some of them
    error?: FC;
}> = observer(({ Component, view, params, Loading }) => {
    const [viewProps, setViewProps] = useState<Record<string, any> | null>(null);

    const prevParams = usePrevious(params);

    useEffect(() => {
        // Use shallow comparison
        // `params` may include object like stores and no need to resolve the view again is something changes
        // inside them
        if (!_.isEqual(params, prevParams)) {
            (async () => {
                const res = await resolveView(view, params);
                setViewProps(res);
            })();
        }
    });

    if (viewProps) {
        return <Component {...(viewProps as any)} />;
    } else {
        // TODO: display this only after delay?
        return <Loading />;
    }
});

/**
 * Type for custom components based on ViewLoader (e. g. to have defined loading state)
 */
export type ViewLoaderComponent = GenericViewLoaderComponent<{}>;
