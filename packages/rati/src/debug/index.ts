/*
    rati/debug — opt-in, framework-specific debug tooling, kept out of the main barrel.

    Two sibling console tracers, each one cheap flag read per call site, so their marks live
    permanently on their path and are toggled live:

      - `navTrace` — the navigation timeline (click → pushState → render → resolution),
        `globalThis.__DEBUG__.nav`. See util/navTrace.ts.
      - `dataTrace` — data resolution per island run (level starts, per-cell settles with
        durations), `globalThis.__DEBUG__.data`. See util/dataTrace.ts.
*/
export { navTrace, navTraceStart, navTraceEnabled } from '../util/navTrace';
export { dataTrace, dataTraceEnabled } from '../util/dataTrace';
