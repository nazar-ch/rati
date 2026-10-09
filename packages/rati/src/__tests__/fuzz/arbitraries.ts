import type { Parameters } from 'fast-check';

/*
    long:2
    Fuzz conventions for rati's randomized suites.

      - `fuzz(n)` builds one property's fast-check `Parameters`, `numRuns` defaulting to the
        small per-property `n` so the default `vp run rati#test` stays fast. The knobs:

          FUZZ_RUNS=<m>   raise every property's numRuns to at least m — the deep run
          FUZZ_LEVEL=<l>  scale the SHAPE of generated cases, through `byLevel(base, perLevel)`
          FUZZ_SEED=<s>   pin the generator seed for a whole run

      - `verbose` is always on: a failure prints its `{ seed, path }` and the shrunk
        counterexample. Replay with `FUZZ_SEED=<seed> vp run rati#test src/__tests__/fuzz/`, or
        pin `{ seed, path }` into the property's params.
*/

const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;

function envInt(name: string): number | undefined {
    const raw = env?.[name];
    if (!raw) return undefined;
    const value = Number.parseInt(raw, 10);
    return Number.isNaN(value) ? undefined : value;
}

export function fuzz(numRuns: number): Parameters<unknown> {
    const forcedRuns = envInt('FUZZ_RUNS');
    const seed = envInt('FUZZ_SEED');
    return {
        numRuns: forcedRuns !== undefined ? Math.max(forcedRuns, numRuns) : numRuns,
        verbose: true,
        ...(seed !== undefined && { seed }),
    };
}

/**
 * The deep fuzz budget: the `numRuns` floor scripts/ci.ts's `fuzz` stage runs at. Below it a
 * rare multi-step shape can go ungenerated in a given run.
 */
const DEEP_FUZZ_RUNS = 500;

/**
 * Whether this run is at or above the deep fuzz budget. A coverage guard asserting every listed
 * shape was generated gates on it: at the default budget a multi-step shape can go unreached
 * honestly, and the `fuzz` stage always clears the bar.
 */
export function atDeepFuzzBudget(): boolean {
    return (envInt('FUZZ_RUNS') ?? 0) >= DEEP_FUZZ_RUNS;
}

/** Size a shape knob by complexity level: `base` at FUZZ_LEVEL=0, `+perLevel` per level. */
export function byLevel(base: number, perLevel: number): number {
    return base + (envInt('FUZZ_LEVEL') ?? 0) * perLevel;
}

/**
 * Vitest's per-test timeout for a fuzz property, scaled to its budget: the default bound ignores
 * `FUZZ_RUNS`, and a timeout reads like a property failure with no counterexample. The floor
 * sits above the default too, since a parallel `yarn ci` pass contends. A hang-catcher.
 */
export function fuzzTimeout(): number {
    return Math.max(30_000, (envInt('FUZZ_RUNS') ?? 0) * 30);
}
