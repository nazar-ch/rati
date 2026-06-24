export { sleep } from './util/utils';
export { navTrace, navTraceStart, navTraceEnabled } from './util/navTrace';

export { ActiveData, ActiveApiData } from './data/ActiveData';
export { type ActiveDataInstanceType } from './data/ActiveDataInstanceType';

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
    type WebRouterStoreOptions,
    type WebRouterHydratedState,
} from './router/store';
export {
    route,
    type RouteOptions,
    type NameToRoute,
    type ExtractRouteParams,
    type GenericRouteType,
    type RatiUserTypes,
    type RouteContextValueOf,
    type RouteContextNames,
} from './router/route';
export { group, type GroupDefaults } from './router/group';
export { Router } from './router/Router';
export {
    createBrowserHistory,
    createMemoryHistory,
    type History,
    type Location as HistoryLocation,
    type HistoryListener,
    type HistoryUpdate,
    type Action as HistoryAction,
} from './router/history';
export {
    installScrollRestoration,
    type ScrollRestorationOptions,
} from './router/scrollRestoration';

export * from './types/generic';

export { Link, ContextualLink, LinkContextProvider, useLinkContext } from './router/Link';
export { lazy, type PreloadableLazyComponent } from './router/lazy';
export { Navigate } from './router/Navigate';
export { prepareRoute, type PreparedRoute } from './router/prepareRoute';

export { remoteData } from './data/remoteData';
export { remoteDataKey, responseKey } from './data/apiUtils';

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
} from './scope/scope';

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
} from './scope/source';

export { useScope, useOptionalScope } from './mandala/channel';

export {
    island,
    type IslandComponent,
    type IslandConfig,
    IslandHydrationProvider,
    createIslandHydrationCollector,
    type IslandHydration,
    type IslandHydrationData,
} from './island/island';

export { useRouteContext } from './router/useRouteContext';

if (import.meta.env.DEV) {
    const pkg = await import('../package.json');
    console.log(`*********************** 🦜 rati @${pkg.version} LOCAL ***********************`);
}
