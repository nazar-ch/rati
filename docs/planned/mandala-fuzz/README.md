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

## Per-item conventions

rati works in atomic commits on the current branch (its `CLAUDE.md`); prefix subjects with the
item id (`MF-01: …`), put `Closes: MF-01` in the finishing commit's trailer block, keep
`vp run rati#typecheck` + `vp lint` + `vp run rati#test` green, and push. Findings that are out
of an item's scope get a dated note appended here, not a silent fix.
