/*
    rati/ssr — the server-facing surface, kept out of the client-focused main barrel: the mandala
    engine's SSR dehydration (`HydrationProvider`, mounted on both sides) and `prepareRoute`.
*/
export {
    HydrationProvider,
    createHydrationCollector,
    type Hydration,
    type HydrationData,
    type HydrationError,
    type HydrationErrors,
} from '../mandala/hydration.js';

export { prepareRoute, type PreparedRoute } from '../router/prepareRoute.js';

export { headTags } from './headTags.js';

export {
    serializeHydration,
    readHydration,
    HYDRATION_SCRIPT_ID,
    type HydrationState,
} from './payload.js';

export { renderToHtml, type RenderToHtmlOptions } from './renderToHtml.js';
export {
    renderApp,
    type RenderAppOptions,
    type RenderAppSetup,
    type RenderAppInstance,
    type RenderAppResult,
    type RenderAssets,
} from './renderApp.js';
