# MF-04 — kill register: prove the harness bites, file the recipes

area: packages/rati/src/__tests__/fuzz, docs/archive/mandala-testing.md
needs: MF-02, MF-03
disposition: —

## Problem

"Bulletproof" is a property of the tests, not the code (jnana's QA-12 discipline,
`.claude/fuzz-testing.md` §"Per-suite kill recipes"): a harness enters service only after each
planned kill — a one-line reintroduction of a bug-shaped mutation — has been run red, shrunk, and
reverted. A harness that survives its kill is the counterfeit-provider failure mode and gets
fixed, not shipped. The six planned kills are listed in
[mandala-testing.md](docs/archive/mandala-testing.md) §"Kill register".

## Scope

1. Execute each kill against the landed suite (mutation sites, current as of the refresh
   implementation — re-verify against code first):
   - `src/mandala/refresh.ts` `settled()`: force `changed = false` → convergence fails.
   - `src/mandala/refresh.ts` `markDependents()`: walk only `levelIndex + 1` → transitive
     cascade convergence fails.
   - `src/mandala/refresh.ts` `settled()`: drop the `refreshing?.token !== token` guard →
     the superseded-settle interleaving fails.
   - `src/mandala/resolver.tsx` `processDirtyCells()`: swap the pending promise in immediately
     (defeat stale-while-refetch) → no-blank fails.
   - `src/mandala/refresh.ts` `trackReads()`: return an empty read-set → cascade never fires,
     convergence fails.
   - `src/mandala/resolver.tsx` detach effect: always detach on a `[sources]` change → the
     MF-03 ledger fails.
2. For each: record mutation → command → observed failure + shrunk counterexample shape → revert.
   Mutations never merge.
3. Write the executed register into mandala-testing.md's kill section (replacing "planned" with
   the executed recipes), so re-verification is a copy-paste away.
4. Verify the non-vacuity counters (MF-02 §5) genuinely gate: neuter one (make the refresh
   guarantee a no-op) and confirm the suite complains.

## Boundaries

- No suite changes beyond what a surviving kill forces (a survived kill means the invariant is
  mis-encoded — fix the *test*, re-kill, and note it).
- No engine changes, period — every mutation is reverted.

## Verify

- All six kills red-then-reverted; working tree clean afterward (`git status`).
- The register section committed; each recipe names mutation site, command, and failure shape.
- Full suite green post-revert: `vp run rati#test` + `vp lint` + `vp run rati#typecheck:test`.
