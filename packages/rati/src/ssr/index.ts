/*
    rati/ssr — the server-facing surface, grouped into its own entry so the main barrel
    stays client-focused.

    Everything a server entry needs to render a rati app and dehydrate its data:

      - `HydrationProvider` / `createHydrationCollector` — the mandala engine's SSR
        dehydration. Wrap the app at the SSR boundary; the server passes `collect`, the
        client passes the collected `data` back so it rehydrates without re-running loads.
        (`HydrationProvider` renders on the client too — mount it on both sides so the
        trees stay identical and each mandala's `useId` is stable.)
      - `prepareRoute` — drive a memory-history router to its matched route and snapshot
        the routing state for client hydration (SSR-only).

    There is exactly one hydration mechanism, and route islands use it too — hence the
    plain `Hydration*` names (no `Island` prefix). See mandala/hydration.tsx and
    router/prepareRoute.ts for the implementations.
*/
export {
    HydrationProvider,
    createHydrationCollector,
    type Hydration,
    type HydrationData,
    type HydrationError,
} from '../mandala/hydration';

export { prepareRoute, type PreparedRoute } from '../router/prepareRoute';

export { headTags } from './headTags';

export {
    serializeHydration,
    readHydration,
    HYDRATION_SCRIPT_ID,
    type HydrationState,
} from './payload';

export { renderToHtml, type RenderToHtmlOptions } from './renderToHtml';
export {
    renderApp,
    type RenderAppOptions,
    type RenderAppSetup,
    type RenderAppInstance,
    type RenderAppResult,
    type RenderAssets,
} from './renderApp';
