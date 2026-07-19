/*
    rati/testing — test utilities for apps built on rati, and for rati itself. Every
    primitive here was hand-rolled across both repos' suites (a deferred promise ~10×, an
    act-microtask flush 100+×, a controllable source ~8×); this entry is their sanctioned
    home. All of it is test-environment-only — `flush` and the harness call React's `act`,
    which warns outside a configured test runner.

    Depends on `react` / `react-dom/client` (already peers). It does *not* pull in
    `@testing-library/react`: the render harness uses `react-dom/client` directly and
    returns a container you can query with whatever you already use.
*/

export { deferred, type Deferred } from './deferred';
export { flush } from './flush';
export {
    controllableSource,
    type ControllableSource,
    type ControllableSourceOptions,
} from './controllableSource';
