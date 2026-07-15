# router-fuzz — implementation plan

Items live in [issues/](./issues/); status derives from rati git (`git log --grep 'RF-'`,
`Closes:` trailers). No status here.

## Batches

### B1 — hardening (execution; semantics gate)

- **Items:** RF-01.
- **Entry:** the user decides the param codec semantics (README finding 1 — encode on
  `getPath` / decode on match, or something narrower). Findings 2–4 need no decision.
- **Exit / checkpoint:** fixes landed with their pins; existing suites green (the codec
  change may move pinned strings — each such edit is reviewed against the *contract*, not
  just made green).

### B2 — foundation (execution; calibration gate)

- **Items:** RF-02.
- **Entry:** B1 merged (the model's round-trip expectations assume the decided codec).
- **Exit / checkpoint:** traversable memory history + routes arbitrary + reference model +
  smoke property land; the **user reviews the invariant altitude** before B3 — every later
  item encodes invariants against this bar.

### B3 — coverage (execution; two lanes)

- **Items:** RF-03 (command model — grows the fuzz harness files), RF-04 (deterministic
  pins in the existing `__tests__/router/` suites; independent lane, may run in parallel).
- **Entry:** B2 merged and its altitude review done.
- **Exit / checkpoint:** fuzz suite green at default budget and at `FUZZ_RUNS=500`; the
  pin audit filed (what existed, what was added); checkpoint report of product findings.

### B4 — kill audit (execution; aggregation tail)

- **Items:** RF-05.
- **Entry:** RF-03, RF-04 merged.
- **Exit:** every planned kill executed red and reverted; recipes filed; non-vacuity
  counters verified. Effort ready to close.

## Grading

| Item | Model / effort | Why |
| --- | --- | --- |
| RF-01 | Opus, medium | small fixes, but the codec change ripples through pinned suites |
| RF-02 | Opus, high | the model + history design set the effort's bar; judgment-dense |
| RF-03 | Opus, high | invariant encoding over traversal interleavings — the subtle heart |
| RF-04 | Opus, medium | pin audit against 21 existing suites; discipline over invention |
| RF-05 | Opus, medium | mutation discipline: honest kills, honest reverts |

The Agent tool sets `model` but not reasoning-effort — carry the effort tier as a
thoroughness line in the prompt.

## Orchestration notes

- Suits the **Agent tool** (small heterogeneous batches, user checkpoints), not Workflow.
- All items commit to rati `main` directly; B3's two lanes touch disjoint files
  (`__tests__/fuzz/router*` vs `__tests__/router/`) — sequential is fine and simpler.
- Budgets are part of the deliverable: the default `vp run rati#test` stays fast
  (~seconds); deep runs ride `yarn ci`'s fuzz stage (`FUZZ_RUNS=500` default).
- The mandala-fuzz learnings apply verbatim and are worth re-reading before B2/B3:
  pinned seeds in kill recipes (an unpinned green is weak evidence), the counters gate
  against vacuous passes, and "an unexecuted kill note is a guess".
