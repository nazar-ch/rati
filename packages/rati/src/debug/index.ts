/*
    rati/debug — opt-in, framework-specific debug tooling, kept out of the main barrel.

    Currently the navigation-timeline tracer (`navTrace` and friends): every call is one
    cheap flag read, so the marks can live permanently on the navigation path and are
    toggled live via `globalThis.__DEBUG__.nav`. See util/navTrace.ts for the mechanism.
*/
export { navTrace, navTraceStart, navTraceEnabled } from '../util/navTrace';
