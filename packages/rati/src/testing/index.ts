/*
    rati/testing — test-environment utilities for apps on rati and for rati itself, over
    `react-dom/client` with no `@testing-library/react`. The MobX-backed `rati/data` half is
    `rati/testing/data`, so this barrel stays MobX-free.
*/

export { deferred, type Deferred } from './deferred.js';
export { flush } from './flush.js';
export {
    controllableSource,
    type ControllableSource,
    type ControllableSourceOptions,
} from './controllableSource.js';
export { cleanup } from './dom.js';
export { renderIsland, type IslandHandle, type RenderIslandOptions } from './renderIsland.js';
export { createTestRouter, type TestRouter, type CreateTestRouterOptions } from './router.js';
export {
    prerenderToString,
    ssrRender,
    type PrerenderToStringOptions,
    type SsrRenderOptions,
    type ServerRender,
    type HydratedTree,
    type HydrateOptions,
} from './ssr.js';
