export { sleep } from './common/stuff';

export { ActiveData, ActiveApiData } from './stores/ActiveData';
export { type ActiveDataInstanceType } from './stores/ActiveDataInstanceType';

export {
    RootStore,
    type RootStoreOptions,
    type GlobalStores,
    useGenericStores,
    useWebRouter,
    RootStoreProvider,
    GenericStoresContext,
    createUseStoresHook,
} from './stores/RootStore';
export { GlobalStore } from './stores/GlobalStore';

export {
    WebRouterStore,
    route,
    type RouteOptions,
    type NameToRoute,
    type WebRouterStoreOptions,
    type WebRouterHydratedState,
    type ExtractRouteParams,
    type GenericRouteType,
    type RatiUserTypes,
    type RatiRouteContexts,
} from './stores/WebRouterStore';
export { Router } from './common/Router';
export {
    createBrowserHistory,
    createMemoryHistory,
    type History,
    type Location as HistoryLocation,
    type HistoryListener,
    type HistoryUpdate,
    type Action as HistoryAction,
} from './common/history';
export {
    installScrollRestoration,
    type ScrollRestorationOptions,
} from './common/scrollRestoration';

export * from './types/generic';

export { Link, ContextualLink, LinkContextProvider, useLinkContext } from './common/GenericLink';
export { lazy, type PreloadableLazyComponent } from './common/lazy';
export { Navigate } from './common/Navigate';
export { prepareRoute, type PreparedRoute } from './common/prepareRoute';

export { remoteData } from './common/remoteData';
export { remoteDataKey, responseKey } from './common/apiUtils';

export {
    type ChainableView,
    type CreateView,
    createView,
    type ResolveView,
    type RequiredViewParams,
    type ViewComponent,
    type ViewParam,
    viewParam,
    type ViewContextDef,
    ParamSymbol,
    ViewSymbol,
    ViewDefinitionsSymbol,
    ViewContextSymbol,
} from './common/view';

export {
    NotAvailableError,
    SourceSymbol,
    isSource,
    readySource,
    promiseSource,
    toSource,
    toSourceError,
    type Source,
    type SourceState,
    type SourceError,
} from './common/source';

export {
    createIsland,
    useIslandProps,
    useIslandContext,
    useOptionalIslandContext,
    IslandSymbol,
    type IslandComponent,
    type IslandConfig,
    type IslandViewFactory,
    type IslandViewOf,
    type IslandProps,
    type IslandParams,
} from './experimental/island';

export {
    IslandHydrationProvider,
    createIslandHydrationCollector,
    type IslandHydration,
    type IslandHydrationData,
} from './experimental/islandHydration';

export { useRouteContext } from './common/useRouteContext';

if (import.meta.env.DEV) {
    const pkg = await import('../package.json');
    console.log(`*********************** 🦜 rati @${pkg.version} LOCAL ***********************`);
}
