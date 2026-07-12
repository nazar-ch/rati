# MF-02 — fc.commands model: the event alphabet + behavioral invariants

area: packages/rati/src/__tests__/fuzz
needs: MF-01
disposition: —

## Problem

The smoke property (MF-01) covers initial resolution only. The bugs worth searching for live in
interleavings: refreshes racing settles, cascades racing input changes, sources transitioning
mid-refresh. This item turns the harness into an `fc.commands` model-based suite — the
`documentClient.commands` pattern from jnana's `.claude/fuzz-testing.md` §"Model-based testing":
a command alphabet drives the real island against the MF-01 reference model, invariants assert
after every command, fast-check shrinks failures to a minimal command sequence.

## Scope

1. The command alphabet (each an `fc.Command` with `check` as the causality gate — e.g. `settle`
   only when something is held pending; every `run` wraps `act`):
   `settle(key)` / `reject(key)` (held deferreds — initial loads and in-flight refreshes),
   `sourceReady(key, gen)` / `sourcePend(key)` / `sourceError(key)`,
   `refresh(key)` (through a `useScopeControls` probe; promise-load keys only),
   `refreshAll()`, `changeInput()` (remount semantics; in-flight bookkeeping must settle).
2. Model updates per command, mirroring the *contract*: a `refresh` on a `fresh`-payload key
   marks it in flight and, on settle, cascades to transitive readers; a `stable` payload settles
   with no cascade; `refreshAll`/`changeInput` reset to initial-resolution semantics.
3. Invariants after every command (the numbered list in
   [mandala-testing.md](../../../research/mandala-testing.md) §"Invariants" — encode 1–5 and 7
   here; 6, the lifecycle ledger, is MF-03's): slot correctness, no-blank during selective
   refresh, identity stability for `stable` payloads, run-count **upper bounds** + no idle runs,
   `pending` agreement at quiesce points.
4. The quiesce tail: settle everything held, flush, assert convergence (rendered ≡ model
   recomputation); unmount in `finally`. A generated fraction of runs **skips the quiesce
   tail** and unmounts mid-flight: late settles must be inert and the ledger must balance
   with never-attached sources at 0/0 — situation S5 of
   `packages/rati/src/__tests__/suspense-situations.md` (read that catalog before writing
   the commands; S2's async-act mount rule applies to every command's `act` usage).
5. **Non-vacuity:** the sequence arbitrary guarantees ≥1 `refresh` of a `fresh` key (or the case
   is discarded via precondition), and a suite-level counter asserts refresh-with-change actually
   occurred across the run set.
6. Stretch (only if green and cheap): a spec variant adding `data(fn, { equals })` keys whose
   comparer ignores the generation counter — the model then expects no cascade despite `fresh`.

## Boundaries

- Same harness files as MF-01/MF-03 — this is the serialization lane; coordinate by running
  after MF-01 and before/with MF-03 in one lane.
- The altitude rule binds (no mechanics in model or asserts).
- Kill executions are MF-04's — but write the code with those six kills in mind (the register in
  mandala-testing.md §"Kill register"): if an invariant obviously couldn't catch its kill,
  it's mis-encoded.
- No engine changes; real bugs found → minimal deterministic pin + checkpoint report.

## Verify

- `vp run rati#test src/__tests__/fuzz/` green at default budget (`fuzz(25)`,
  `maxCommands` via `byLevel(8, 4)`); `FUZZ_RUNS=500` green.
- A replay recipe works: pin a `{ seed, path }` into the property params and get the identical
  case.
- `vp run rati#typecheck:test` + `vp lint` green; default whole-suite runtime still ~seconds.
