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
    RouteContextSymbol,
    type RouteContextValueOf,
    type RouteContextNames,
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
    type ChainableScope,
    type Scope,
    scope,
    type ScopeProps,
    type ScopeParams,
    type ScopeProvidesOf,
    type ScopeComponent,
    type Prop,
    prop,
    hook,
    type HookLoad,
    type ScopeProvideDef,
    ParamSymbol,
    ScopeSymbol,
    ScopeDefinitionsSymbol,
    ScopeProvidesSymbol,
} from './common/scope';

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
    island,
    useScope,
    useOptionalScope,
    IslandSymbol,
    type IslandComponent,
    type IslandConfig,
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
