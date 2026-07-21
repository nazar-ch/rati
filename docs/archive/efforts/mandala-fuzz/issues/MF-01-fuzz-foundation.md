---
area: packages/rati/src/__tests__/fuzz
needs: —
status: done
disposition: —
---

# MF-01 — fuzz foundation: scope harness, reference model, smoke property

## Problem

The mandala's deterministic suites pin known behaviors by example; resolver bugs live in the
space of *scope shapes × event interleavings* nobody enumerated (the jnana experience: ordering
bugs surface one review at a time unless made searchable). There is no randomized coverage of the
engine at all. This item builds the searchable form's foundation: an arbitrary over scope
*specs*, a harness that turns a spec into a real instrumented island, a plain-JS reference model
that computes what the island must show, and one smoke property proving the loop works
end to end. Design record: [mandala-testing.md](docs/archive/mandala-testing.md) §"The fuzz
foundation" (read it first — the KeySpec shape, the deterministic value formula, and the
invariant altitude are specified there, not here).

Tooling: `fast-check` + `@fast-check/vitest` (add as devDependencies of the `rati` workspace,
pinned like jnana: `^4.8.0` / `^0.4.1`). Conventions ported from jnana's
`.claude/fuzz-testing.md`: per-suite `arbitraries.ts` with a `fuzz(n)` params builder,
`FUZZ_RUNS` (raise every property's `numRuns`), `FUZZ_LEVEL` + `byLevel(base, perLevel)` (grow
case *shape*), `FUZZ_SEED` (replay), `verbose` always on so failures print `{ seed, path }` +
the shrunk counterexample.

## Scope

1. `packages/rati/src/__tests__/fuzz/arbitraries.ts` — `fuzz(n)`, `byLevel`, the env knobs above;
   a file-header comment documenting the knobs and the replay recipe (this is rati's first fuzz
   suite — the header is the local convention record).
2. `packages/rati/src/__tests__/fuzz/scopeHarness.tsx` —
   - the `KeySpec` arbitrary: 1–4 levels, 1–3 keys per level (both grown by `byLevel`), kind
     `value | promise | source`, `reads` ⊆ strictly-earlier keys, payload `fresh | stable`;
   - the builder: spec → a real `scope()` chain + `island()` with instrumented producers —
     each computes its value deterministically from its reads' current values + a per-key
     generation counter (bumped per run only for `fresh`), promise producers return
     harness-held deferreds, source producers return harness-held controllable sources
     (the `testSource` shape from `__tests__/mandala/scopeControls.test.tsx`);
   - the reference model: per key `{ status, value, runCount, gen }` + derived expected slot,
     expected rendered values, and the attach ledger. No React, no engine imports — the model is
     the contract's semantics, auditable by eye.
3. `packages/rati/src/__tests__/fuzz/mandala.smoke.fuzz.test.tsx` — the smoke property: generate
   a spec, mount the island, settle every held deferred/source in a fast-check-chosen order
   (assert slot correctness after each settle), then at quiesce assert **convergence** (every
   rendered value equals the model's) and, in a `finally`, unmount and assert the attach ledger
   balanced. Default budget `fuzz(25)`.
4. Prove the loop bites before calling it done: temporarily flip the harness value formula (or a
   settle ordering), watch the property fail *and shrink to a small spec*, revert. Note the check
   in the commit message (the full kill register is MF-04's).

## Boundaries

- No command alphabet, no refresh coverage, no lifecycle invariants beyond the balanced-ledger
  finally — those are MF-02/MF-03; this item's deliverable is the harness the others extend.
- The **altitude rule is the acceptance bar** (mandala-testing.md §"The altitude rule"): nothing
  in the model or asserts may encode render counts, effect ordering, or engine internals. When an
  invariant can't be expressed at contract level, leave a `TODO(MF-02)` note instead of reaching
  below the line.
- No engine (`src/mandala/`, `src/scope/`) changes. If the smoke property finds a real bug,
  pin it minimally in the deterministic suite, report at the checkpoint, and leave the fix
  decision to the user.
- Hook loads and `data(fn, { equals })` stay out of the spec alphabet (recorded as MF-02
  stretch).

## Verify

- `cd ~/Sites/rati && vp run rati#test src/__tests__/fuzz/` green; whole-suite
  `vp run rati#test` still ~seconds (the budget is part of the deliverable).
- `FUZZ_RUNS=200 vp run rati#test src/__tests__/fuzz/` green.
- The Scope-step-4 formula-flip demonstrably fails with a shrunk counterexample, then reverts
  green.
- `vp run rati#typecheck` + `vp run rati#typecheck:test` + `vp lint` green.
