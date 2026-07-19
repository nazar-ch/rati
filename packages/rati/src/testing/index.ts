/*
    rati/testing — test utilities for apps built on rati, and for rati itself. Every
    primitive here was hand-rolled across both repos' suites (a deferred promise ~10×, an
    act-microtask flush 100+×, a controllable source ~8×, the island/router mount + provider
    wiring inline everywhere); this entry is their sanctioned home. All of it is
    test-environment-only — the harness and `flush` call React's `act`, which warns outside a
    configured test runner.

    Depends on `react` / `react-dom/client` (already peers). It does *not* pull in
    `@testing-library/react`: the render harnesses use `react-dom/client` directly and return
    a container you can query with whatever you already use.
*/

export { deferred, type Deferred } from './deferred';
export { flush } from './flush';
export {
    controllableSource,
    type ControllableSource,
    type ControllableSourceOptions,
} from './controllableSource';
export { cleanup } from './dom';
export { renderIsland, type IslandHandle, type RenderIslandOptions } from './renderIsland';
export { renderWithStores, type StoresHandle, type RenderWithStoresOptions } from './stores';
export { createTestRouter, type TestRouter, type CreateTestRouterOptions } from './router';
