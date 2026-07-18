// Opt-in debug tooling (`navTrace` and friends) lives in the `rati/debug` entry; the
// MobX bindings (`observableSource`) in `rati/mobx`; the MobX-shaped data primitives
// (`query` / `collection` / `mutation` / `form`) in `rati/data`; the server-facing
// SSR surface (`HydrationProvider`, `createHydrationCollector`, `prepareRoute`) in
// `rati/ssr` — all kept out of the client-focused main barrel.

export {
    RootStore,
    type RootStoreOptions,
    type GlobalStores,
    useGenericStores,
    useRouter,
    RootStoreProvider,
    GenericStoresContext,
    createUseStoresHook,
} from './stores/RootStore';
export { GlobalStore } from './stores/GlobalStore';

export { RouterStore, type RouterStoreOptions, type RouterHydratedState } from './router/store';
export {
    route,
    type RouteOptions,
    type RouteRedirect,
    type RedirectTarget,
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

export {
    type ChainableScope,
    type Scope,
    scope,
    type ScopeProps,
    type ScopeInputs,
    type ScopeProvidesOf,
    type ScopeComponent,
    type Input,
    input,
    hook,
    type HookLoad,
    data,
    type DataLoad,
    type DataLoadOptions,
    type ScopeLoadKeys,
    type ScopeProvideDef,
    InputSymbol,
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
    type SourceSSR,
} from './scope/source';

export { useScope, useOptionalScope } from './mandala/channel';
export { useScopeControls, type ScopeControls } from './mandala/controls';

export { island, type IslandComponent, type IslandConfig } from './island/island';

export {
    createHeadStore,
    HeadStore,
    type HeadStoreOptions,
    type HeadSnapshot,
    type HeadPhase,
    type MetaTag,
} from './head/store';
export { HeadProvider } from './head/HeadProvider';
export { Title } from './head/Title';
export { useTitle } from './head/useTitle';
export { Meta, type MetaProps } from './head/Meta';

export { useRouteContext } from './router/useRouteContext';

if (import.meta.env.DEV) {
    const pkg = await import('../package.json');
    console.log(`*********************** 🦜 rati @${pkg.version} LOCAL ***********************`);
}
