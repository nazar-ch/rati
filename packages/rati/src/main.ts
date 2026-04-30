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
    type NameToRoute,
    type WebRouterStoreOptions,
    type WebRouterHydratedState,
    type ExtractRouteParams,
    type GenericRouteType,
} from './stores/WebRouterStore';
export { Router } from './common/Router';
export {
    createHistory,
    createBrowserHistory,
    createHashHistory,
    createMemoryHistory,
    type History,
    type HistoryType,
    type Location as HistoryLocation,
    type HistoryListener,
    type HistoryUpdate,
    type Action as HistoryAction,
} from './common/history';
export {
    installScrollRestoration,
    type ScrollRestorationOptions,
} from './common/scrollRestoration';

export { ViewLoader, type ViewLoaderComponent } from './common/ViewLoader';

export * from './types/generic';

export { createLinkComponent, useLinkContext } from './common/GenericLink';
export { lazy, type PreloadableLazyComponent } from './common/lazy';
export { Redirect } from './common/Redirect';
export { prepareRoute, type PreparedRoute } from './common/prepareRoute';

export { remoteData } from './common/remoteData';
export { remoteDataKey, responseKey } from './common/apiUtils';

export {
    type CreateView,
    createView,
    resolveView,
    type ViewComponent,
    viewParam,
    ParamSymbol,
    ViewSymbol,
} from './common/view';

if (import.meta.env.DEV) {
    const pkg = await import('../package.json');
    console.log(`*********************** 🦜 rati @${pkg.version} LOCAL ***********************`);
}
