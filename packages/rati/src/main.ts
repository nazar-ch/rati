// Opt-in debug tooling (`navTrace` and friends) lives in the `rati/debug` entry; the
// MobX bindings (`observableSource`) in `rati/mobx`; the MobX-shaped data primitives
// (`query` / `collection` / `mutation` / `form`) in `rati/data`; the server-facing
// SSR surface (`HydrationProvider`, `createHydrationCollector`, `prepareRoute`) in
// `rati/ssr` — all kept out of the client-focused main barrel.

export { createRouter } from './router/createRouter.js';
export {
    type Router,
    type ActiveRoute,
    type ActiveRouteOf,
    type NavigateOptions,
} from './router/router.js';
export { RouterProvider, useRouter } from './router/RouterProvider.js';
export { type RouterOptions, type RouterHydratedState } from './router/store.js';
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
} from './router/route.js';
export { group, type GroupDefaults } from './router/group.js';
export { RouterOutlet } from './router/RouterOutlet.js';
export {
    createBrowserHistory,
    createMemoryHistory,
    type History,
    type Location as HistoryLocation,
    type HistoryListener,
    type HistoryUpdate,
    type Action as HistoryAction,
} from './router/history.js';
export {
    installScrollRestoration,
    type ScrollRestorationOptions,
} from './router/scrollRestoration.js';

export * from './types/generic.js';

export { Link, ContextualLink, LinkContextProvider, useLinkContext } from './router/Link.js';
export { lazy, type PreloadableLazyComponent } from './router/lazy.js';
export { Navigate } from './router/Navigate.js';

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
    type LoadContext,
    type ScopeLoadKeys,
    type ScopeProvideDef,
    InputSymbol,
    ScopeSymbol,
    ScopeDefinitionsSymbol,
    ScopeProvidesSymbol,
} from './scope/scope.js';

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
    type SourceErrorCode,
    type SourceSSR,
} from './scope/source.js';

export { useScope, useOptionalScope } from './mandala/channel.js';
export { useScopeControls, type ScopeControls } from './mandala/controls.js';
// The island's aggregate phase, for a component that stores or switches on one.
export type { IslandPhase } from './mandala/refresh.js';
// The `retry` option's shape, for a config assembled away from the island() call.
// `RetryOption` is the whole option (`RetryOptions | false`) — the policy is on by default.
export type { RetryOption, RetryOptions } from './mandala/retryPolicy.js';

export { island, type IslandComponent, type IslandConfig } from './island/island.js';

export {
    createHeadStore,
    HeadStore,
    type HeadStoreOptions,
    type HeadSnapshot,
    type HeadPhase,
    type MetaTag,
} from './head/store.js';
export { HeadProvider } from './head/HeadProvider.js';
export { Title } from './head/Title.js';
export { useTitle } from './head/useTitle.js';
export { Meta, type MetaProps } from './head/Meta.js';

export { useRouteContext } from './router/useRouteContext.js';

if (import.meta.env.DEV) {
    const pkg = await import('../package.json');
    console.log(`*********************** 🦜 rati @${pkg.version} LOCAL ***********************`);
}
