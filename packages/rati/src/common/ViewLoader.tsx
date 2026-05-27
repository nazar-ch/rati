import { observer } from 'mobx-react-lite';
import { type ComponentType, type FC, type ReactElement, useEffect, useRef, useState } from 'react';
import { resolveView, type ViewComponent, type CreateView, type RequiredViewParams } from './view';
import { deepEqual } from './utils';

/* 
Previous version with Refs for reference

const LegacyViewLoader: LegacyGenericViewLoaderComponent<{
    Loading: ComponentType;
    // TODO: support this with ErrorBoundary, add "retry" link in errors for some of them
    error?: FC;
}> = observer(({ Component, view: viewClass, params, stores, Loading }) => {
    const viewRef = useRef<View<any> | null>(null);
    const paramsRef = useRef<Record<string, unknown> | null>(null);

    if (!deepEqual(paramsRef.current, params)) {
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
    const ref = useRef<T | undefined>(undefined);
    useEffect(() => {
        ref.current = value;
    });
    return ref.current;
}

export const ViewLoader: GenericViewLoaderComponent<{
    Loading: ComponentType;
    // TODO: support this with ErrorBoundary, add "retry" link in errors for some of them
    error?: FC;
    /**
     * Pre-resolved view props from server hydration. When provided, the first
     * render uses these props directly and skips the initial async resolve, so
     * the client renders the same content as the SSR HTML on first paint.
     * Ignored on subsequent param changes — those go through `resolveView`
     * normally.
     */
    initialViewProps?: Record<string, any> | undefined;
}> = observer(({ Component, view, params, Loading, initialViewProps }) => {
    const [viewProps, setViewProps] = useState<Record<string, any> | null>(
        initialViewProps ?? null
    );

    const prevParams = usePrevious(params);
    // Track the params we hydrated against so the first effect can skip its
    // async resolve. If params change later the effect falls through to the
    // normal diff/resolve path.
    const hydratedParamsRef = useRef<typeof params | null>(initialViewProps ? params : null);

    useEffect(() => {
        if (hydratedParamsRef.current && deepEqual(params, hydratedParamsRef.current)) {
            // First mount with hydrated props — already have data.
            hydratedParamsRef.current = null;
            return;
        }
        // Use shallow comparison
        // `params` may include object like stores and no need to resolve the view again is something changes
        // inside them
        if (!deepEqual(params, prevParams)) {
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
