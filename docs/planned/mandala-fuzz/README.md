# mandala-fuzz — randomized testing foundation for the mandala engine

Cut 2026-07-12. Per-item status derives from rati git (`git log --grep 'MF-'`) — never from
this file; see Decisions below.

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

### 2026-07-15 (MF-02) — a source leaks when a teardown is followed by a new generation

Found by the command property **on its first run** (shrunk to a 4-level scope +
`reject(k3_1), changeInput`), then reduced to two hand-written repros. **Fixed** on the
user's call — the ledger invariant (6) is MF-03's whole item and could not be encoded around
it. Pinned by `packages/rati/src/__tests__/mandala/orphanedBucketLeak.test.tsx`.

A Step's detach effect deliberately keeps entries the *live* bucket still holds — it cannot
tell a source swap from an unmount, so it defers to the mandala's unmount sweep. So a Step
torn down **while its bucket is still current** leaves its sources attached. Two ways in, no
remount needed: a source erroring (the boundary swaps the subtree for the error slot), and a
mid-tree source dropping to pending (S8 — the levels below unmount for real). A following
generation (retry / input change) then rebuilds `cacheRef.current` into a *fresh* bucket
array, orphaning the old one — and `sweepDetach` only ever sees `cacheRef.current`. Nothing
detaches those sources, ever.

The ordinary remount path is fine: the mandala re-renders before the old Steps' cleanups run,
so `currentBuckets()` already points at the new array, `bucketIsLive` is false, and everything
detaches. It is specifically *teardown-then-replace* that leaks — which is the plain
error-slot → **retry** flow, and the plain "live source blipped, then navigate" flow.

The fix: the mandala queues each replaced bucket array and sweeps it from the `treeCommitted`
effect — off the render path, since a discarded render must not detach. Idempotent against the
ordinary remount path, which never had the bug (there the mandala re-renders before the old
Steps' cleanups run, so `bucketIsLive` is already false and the Steps detach everything
themselves; the sweep then finds only what they deferred).

### 2026-07-15 (MF-02) — a cascade stops at a source key

Found while deciding the shape of MF-02's reference model (does the model's expected-value
fixpoint hold through a source key?). Two behaviors, one root cause; **both fixed** on the
user's call.

`RefreshController.sourceReady()` (refresh.ts) calls `emitChanged` — so a `.provide()` factory
whose reads contain the key rebuilds — but never `markDependents`, which is what marks the
later-level cells whose producers read the key. The promise path (`settled()`) and the sync
path (`valueChanged()`) both call it. Consequences:

1. **A refresh cascade died at a source.** `a → b(source) → c`: refreshing `a` with a changed
   value re-created `b` (its rendered value moved), but `c` never re-ran and kept a value
   derived from the old `b` — contradicting the documented promise, "a changed value re-runs
   exactly the downstream loads whose producers read the key" (docs/public/reference.md
   §refresh).
2. **A live source's value change never reached its readers.** `a(source)` going ready(v1) →
   ready(v2) left `b: ({ a }) => derive(a)` rendering `derive(v1)` forever. Same cause. This
   one was a genuine design question — derive *inside* the source (an `observableSource` over
   a computed) may have been the intent — and the user's call was that the waterfall reads as
   a derivation and should behave as one: deriving in a dependent load is not second-class.

The fix: the resolver runs every new source snapshot through the same equals gate as every
other path and calls `valueChanged` when the value moves. Gated on the cell already having a
value, so a *first* ready cascades nothing (the levels below have not run yet; the waterfall
feeds them the value on its way down), and an S8 pending/ready blip recovering onto its old
value moves nothing. `sourceReady()` lost its unconditional `emitChanged` and is bookkeeping
only, so a swap settling on an equal value no longer rebuilds a `.provide()` it did not change.

Pinned by `packages/rati/src/__tests__/mandala/cascadeThroughSource.test.tsx`; documented in
internals.md §the controls channel and docs/public/reference.md §Sources. The fuzz spec
arbitrary reads source keys like any other.

### 2026-07-15 (MF-02) — two observations left standing (no action)

- **`pending` is stale in the error slot.** A cascade-swapped source that errors rather than
  readies stays in `pending` (only the ready path removes it), and nothing clears it until a
  retry's `treeCommitted`. Low impact — an app in the error slot has a torn-down tree — and
  the contract says nothing about the window, so the command property simply does not assert
  `pending` there rather than pin whichever way the engine leans.
- **Kill #3 is caught but not on every seed.** With the refresh token guard removed from
  `settled()`, the command property's superseded-settle invariant fires — reliably under a
  refresh-heavy alphabet, and on roughly 3 of 5 seeds under the shipped one, even with the
  targeted `refreshInFlight` command added for it. The invariant is encoded right; the hit
  rate is alphabet tuning, and belongs to MF-04 with the rest of the kill audit (a pinned
  `FUZZ_SEED` is the cheap answer if tuning does not settle it).

### 2026-07-15 (MF-03) — three notes from the lifecycle ledger (no product findings)

The ledger found no engine bug: every invariant it encodes was green on the first honest run,
and both kills below went red on the code as shipped. What it did turn up:

- **`<StrictMode>` must be the root element `render()` gets.** Nested one component deeper
  (`<Wrapper>` rendering `<StrictMode>{children}</StrictMode>`) React still double-*renders* but
  skips the double-*mount* — no effect cleanup, no re-run — so the mandala's cache is never
  dropped, producers run once, and the variant silently asserts nothing about the lifecycle it
  exists for. Caught only because the run-count bound was tightened to 1 to check the variant
  bit; it passed. The property builds the element and wraps it at the root for this reason, and
  a harness rule worth carrying to any later StrictMode dimension.
- **Kill #6 needs the deep budget.** Inverting the swap-aware detach (`bucketIsLive &&
  bucket.sources.includes(entry)` → always detach) is caught by the new mid-run bound — "nothing
  detached still feeds renders", shrunk to `refresh(k0_2)` on a level holding two sources — but
  only at `FUZZ_RUNS=500`, not at the default 25. The interleaving needs a level with two
  sources where a cascade swaps one of them, which the default budget rarely reaches. Note for
  MF-04's register: teardown balance alone does *not* catch this kill (the Step nulls
  `entry.detach`, so the sweep finds nothing and the counts stay balanced) — the mid-run bound
  is the only thing that bites.
- **Promoting the command model to StrictMode looks cheap but not free.** The frontier and
  ledger invariants carry over untouched (a producer supersedes its own in-flight entry, so the
  live frontier stays one-per-key through the double-mount). What needs work is invariant 5:
  the model's run budget grants one run per generation, and StrictMode makes every generation
  two — but only for the levels that generation actually *reached*, which depends on the
  generated shape. The smoke variant sidesteps it with a range (`1..2`); the command model would
  need the model to count reached levels per generation, which is real modelling work. Left for
  a later call, as the record says.

## Per-item conventions

rati works in atomic commits on the current branch (its `CLAUDE.md`); prefix subjects with the
item id (`MF-01: …`), put `Closes: MF-01` in the finishing commit's trailer block, keep
`vp run rati#typecheck` + `vp lint` + `vp run rati#test` green, and push. Findings that are out
of an item's scope get a dated note appended here, not a silent fix.
