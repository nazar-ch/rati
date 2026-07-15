# mandala-fuzz — randomized testing foundation for the mandala engine

Status: planned 2026-07-12 — B1 (MF-01) cut, awaiting the calibration run + user review.

The first slice of the "paranoid coverage for the whole rati surface" direction: a fast-check
model-based fuzz suite over the mandala (generated scopes × event interleavings), plus the
deterministic pins the selective-refresh / SSR-sources work left open. The strategy record — the
altitude rule, the pin list, the harness/model/invariant design — is
[docs/research/mandala-testing.md](../../research/mandala-testing.md); this effort executes it.
The playbook is jnana's fuzz conventions (`~/Sites/jnana/.claude/fuzz-testing.md`): `fc.commands`
models, kill-tested harnesses, `fuzz(n)` budgets with `FUZZ_RUNS` / `FUZZ_LEVEL` / `FUZZ_SEED`.

The router is the second fuzz target and is deliberately **not** in this effort — its own
planning pass once the mandala foundation proves the harness pattern.

## Decisions taken 2026-07-12

- **The altitude rule is binding** (mandala-testing.md §"The altitude rule"): every assertion
  targets the observable contract — slots, values, identity, convergence, upper-bound run counts,
  the lifecycle ledger — never mechanics. A test that would fail under a legitimate engine
  optimization is a test bug, not a regression. This is the effort's acceptance bar; MF-01's
  review calibrates it.
- **Tracking is manual.** This effort borrows jnana's shapes (records, plan, batches, derived
  status) but none of its tooling: status derives from rati git — `MF-NN:` commit subjects mark
  in-progress, a `Closes: MF-NN` trailer on the finishing commit marks done
  (`git log --grep 'MF-'` is the view). No status is ever written into these files.
- **SSR paths stay deterministic** (pins in MF-05); `prerender`-per-case fuzzing is rejected for
  cost until evidence demands it.

## Items

MF-01 builds the foundation — the spec arbitrary, the instrumented scope harness, the reference
model, and a settle-everything smoke property — and is the **calibration gate**: its review fixes
the invariant altitude everything else fans out under. MF-02 adds the command alphabet and the
behavioral invariants (slot correctness, no-blank, convergence, run-count bounds, `pending`);
MF-03 adds the lifecycle ledger (attach/detach accounting across swaps and teardown) and the
StrictMode variant — same harness files as MF-02, so they run as one lane. MF-05 is independent
of the harness: the nine deterministic pins from the strategy doc, each with its kill note.
MF-04 closes: execute the six planned harness kills, file the recipes, prove non-vacuity.

Batching, dependencies, grading: [plan.md](./plan.md).

## Findings

### 2026-07-15 (MF-02) — a cascade stops at a source key

Found while deciding the shape of MF-02's reference model (does the model's expected-value
fixpoint hold through a source key?). Two behaviors, one root cause; **not fixed** — the fix
decision is the user's, per every record's Boundaries.

`RefreshController.sourceReady()` (refresh.ts) calls `emitChanged` — so a `.provide()` factory
whose reads contain the key rebuilds — but never `markDependents`, which is what marks the
later-level cells whose producers read the key. The promise path (`settled()`) and the sync
path (`valueChanged()`) both call it. Consequences:

1. **A refresh cascade dies at a source.** `a → b(source) → c`: refreshing `a` with a changed
   value re-creates `b` (its rendered value moves), but `c` never re-runs and keeps a value
   derived from the old `b`. This contradicts the documented promise — "a changed value re-runs
   exactly the downstream loads whose producers read the key" (docs/public/reference.md
   §refresh) — so it reads as a plain bug.
2. **A live source's value change never reaches its readers.** `a(source)` going ready(v1) →
   ready(v2) leaves `b: ({ a }) => derive(a)` rendering `derive(v1)` forever. Same cause;
   **open question** whether it is a bug or the intended division of labor (derive inside the
   source — an `observableSource` over a computed — rather than in a dependent load). Nothing
   in docs/public, internals.md, or the refresh design record says either way. If it is
   intentional it wants documenting; the waterfall reads as a derivation today.

Pinned (contract-asserting, `test.fails` so the suite stays green and flips loudly when fixed):
`packages/rati/src/__tests__/mandala/cascadeThroughSource.test.tsx`.

Cost to the fuzz suite: MF-02's spec arbitrary excludes source-kind keys from later levels'
read-sets, since the model's convergence fixpoint cannot hold across the gap. Sources as
cascade *targets* (the swap path) stay fully covered — only source-as-cascade-*origin* chains
are out. Lift the restriction when the pins flip.

## Per-item conventions

rati works in atomic commits on the current branch (its `CLAUDE.md`); prefix subjects with the
item id (`MF-01: …`), put `Closes: MF-01` in the finishing commit's trailer block, keep
`vp run rati#typecheck` + `vp lint` + `vp run rati#test` green, and push. Findings that are out
of an item's scope get a dated note appended here, not a silent fix.
