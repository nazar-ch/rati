# mandala-fuzz — implementation plan

Items live in [issues/](./issues/); status derives from rati git (`git log --grep 'MF-'`,
`Closes:` trailers). No status here.

## Batches

### B1 — foundation (execution; calibration gate)

- **Items:** MF-01.
- **Entry:** this cut reviewed by the user.
- **Exit / checkpoint:** the harness + smoke property land; the **user reviews the invariant
  altitude** (the lock-in balance from
  [mandala-testing.md](../../research/mandala-testing.md) §"The altitude rule") before B2 —
  every later item encodes invariants against this bar, so the review is a calibration gate in
  judgment, not just a merge dependency. The session that implemented refresh/SSR-sources may run
  this inline; the record is written for a cold agent regardless.

### B2 — coverage (execution; two lanes)

- **Items:** MF-02 → MF-03 (serialization lane: both grow the same harness files —
  `__tests__/fuzz/` — one agent takes both in sequence), MF-05 (independent lane: deterministic
  pins in the existing suites; may run in parallel with the other lane).
- **Entry:** B1 merged and its altitude review done.
- **Exit / checkpoint:** fuzz suite green at default budget and at `FUZZ_RUNS=500`; the nine pins
  green; checkpoint report of any product findings (a pin or property that exposes a real engine
  bug is a finding to surface, not to silently fix — see each record's Boundaries).

### B3 — kill audit (execution; aggregation tail)

- **Items:** MF-04.
- **Entry:** MF-02, MF-03, MF-05 merged (the kills exercise the full suite).
- **Exit:** every planned kill executed red and reverted; recipes filed in the strategy doc's
  kill register; non-vacuity counters verified. Effort ready to close.

## Grading

| Item | Model / effort | Why |
| --- | --- | --- |
| MF-01 | Opus, high | the model + altitude set the effort's bar; judgment-dense |
| MF-02 | Opus, high | invariant encoding over interleavings — the subtle heart |
| MF-03 | Opus, medium | ledger bookkeeping against a fixed harness |
| MF-04 | Opus, medium | mutation discipline: honest kills, honest reverts |
| MF-05 | Opus, medium | small pins, but each needs the refresh/SSR implementation understood |

The Agent tool sets `model` but not reasoning-effort — carry the effort tier as a thoroughness
line in the prompt.

## Orchestration notes

- Suits the **Agent tool** (small heterogeneous batches, user checkpoints), not Workflow.
- All items commit to rati `main` directly (rati's convention) — B2's two lanes touch disjoint
  files, so parallel agents need separate worktrees only if run simultaneously; sequential is
  fine and simpler.
- Budgets are part of the deliverable: the default `vp run rati#test` must stay fast (~seconds);
  deep runs are manual `FUZZ_RUNS=…` until a nightly lane is worth wiring.
