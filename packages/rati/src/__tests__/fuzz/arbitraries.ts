import type { Parameters } from 'fast-check';

/*
    Fuzz conventions for rati's randomized suites (ported from jnana's fuzz playbook —
    ~/Sites/jnana/.claude/fuzz-testing.md). Effort record: docs/planned/mandala-fuzz/.

      - `fuzz(n)` builds the fast-check `Parameters` for one property. `numRuns` defaults to
        the small per-property `n`, so the default `vp run rati#test` stays fast; the knobs:

          FUZZ_RUNS=<m>   raise every property's numRuns to at least m (the manual deep run):
                          FUZZ_RUNS=500 vp run rati#test src/__tests__/fuzz/
          FUZZ_LEVEL=<l>  scale the *shape* of generated cases (0 = default) — suites size
                          their knobs with `byLevel(base, perLevel)`; orthogonal to FUZZ_RUNS
                          (case count vs case size).
          FUZZ_SEED=<s>   pin the generator seed for a whole run.

      - `verbose` is always on: a failure prints `Property failed … { seed, path } …` plus the
        shrunk counterexample. Replay: `FUZZ_SEED=<seed> vp run rati#test src/__tests__/fuzz/`,
        or pin `{ seed, path }` into that property's params for the exact shrink path.
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

/** Size a shape knob by complexity level: `base` at FUZZ_LEVEL=0, `+perLevel` per level. */
export function byLevel(base: number, perLevel: number): number {
    return base + (envInt('FUZZ_LEVEL') ?? 0) * perLevel;
}
