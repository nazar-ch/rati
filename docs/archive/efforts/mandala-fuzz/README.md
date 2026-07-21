# mandala-fuzz — randomized testing foundation for the mandala engine

> **Archived 2026-07-19** — closed tracker, kept as the historical record. Successor:
> [router-fuzz](docs/archive/efforts/router-fuzz/README.md), the second fuzz target this
> one unblocked. No open items carried; the strategy record it executes is
> [mandala-testing.md](docs/archive/mandala-testing.md).

Status: **done — cut 2026-07-12, closed & archived 2026-07-19.** Per-item status is each
record's own `status:` field — never from this file; see Decisions below.

The first slice of the "paranoid coverage for the whole rati surface" direction: a fast-check
model-based fuzz suite over the mandala (generated scopes × event interleavings), plus the
deterministic pins the selective-refresh / SSR-sources work left open. The strategy record — the
altitude rule, the pin list, the harness/model/invariant design — is
[docs/archive/mandala-testing.md](docs/archive/mandala-testing.md); this effort executes it.
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
- **Tracking is manual.** This effort borrows jnana's shapes (records, plan, batches) but none
  of its tooling. *At cut:* status derived from rati git — `MF-NN:` commit subjects marked
  in-progress, a `Closes: MF-NN` trailer on the finishing commit marked done. **Superseded
  2026-07-21**, when the tree adopted jnana's record convention wholesale: status is each
  record's own `status:` field, and the trailers stay only in this effort's history.
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

Batching, dependencies, grading: [plan.md](plan.md).

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

### 2026-07-15 (MF-04) — six kills executed, no engine bug, no suite change

All six went red on the code as shipped and were reverted; the executed recipes are in
[mandala-testing.md](docs/archive/mandala-testing.md) §"Kill register". No kill survived, so no
invariant needed re-encoding and the suite is untouched. What the audit turned up:

- **The recipes pin `FUZZ_SEED`, and that is the honest answer, not a workaround.** MF-02 left
  this open for kill #3 ("a pinned `FUZZ_SEED` is the cheap answer if tuning does not settle
  it"); the audit found the same shape on kill #1 and generalized it. Kill #1 survives ~10% of
  unpinned default-budget seeds (measured 1/10, plus one more in an earlier sample) and kill #3
  survives seeds 1, 2, 3 and 42 while dying on 7 — roughly 1 case in 70 at `FUZZ_RUNS=2000`.
  Both invariants are encoded correctly and catch the bug the moment the search reaches it: what
  varies is *reachability*, and a widened run finds all six unpinned. The register therefore
  treats an unpinned green as no evidence. Raising the default `numRuns` would buy reliability
  at the cost of the seconds-long default run; pinning buys it for free, which is what
  `FUZZ_SEED` was built for.
- **Kill #5's failure shape is not the one the register predicted.** The plan said an empty
  `trackReads` set fails convergence; it actually fails `assertProvideRebuild` — *"a changed
  value must rebuild the provided value"* — on every seed tried (1, 2, 3, 7). The `.provide()`
  factory reads every key, making it the universal dependent and the read-set's canary: it
  notices mid-run, well before quiesce. Worth knowing that the `withProvide` variant, added in
  MF-03 for the lifecycle half, is also what carries this kill.
- **Kill #6 no longer needs the deep budget, and MF-03's note holds.** It dies at
  `FUZZ_SEED=1` on the default `fuzz(100)` (MF-03 saw it only at `FUZZ_RUNS=500`, when the
  default was 25). Confirmed: the mid-run bound is the only thing that bites — the smoke
  property, StrictMode variant included, stays green. The shrink also sharpened it: the swap
  detaches an *untouched sibling* in the same bucket, since a bucket is per level.
- **Kill #2 shrinks past the transitive cascade to a level-skipping read.** The dependent one
  level down is fine; only a reader that skips a level goes stale. A tighter statement of why
  `markDependents` walks every later level.
- **The non-vacuity counters gate.** Removing the refresh verbs from `commandsArb` leaves every
  other invariant green and fails exactly one assert (`no refresh ever changed a value`) — so
  the counter is what stands between a vacuous run and a reported pass.

### 2026-07-15 (MF-05) — twelve pins, no engine bug; three of them were asking the wrong question

Every pin went green against the code as shipped and every kill note went red and was
reverted, so the engine is unchanged. What the item found is in the *specification* and the
harness rules — three of the twelve pins could not be written as the list described them:

- **Pin 7's "error slot in the HTML" does not exist.** A server-side rejection — a promise
  load's or a marked source's — degrades to the **loading** slot behind React's client-retry
  marker; the error boundary never participates server-side. `islandSsrErrors.test.tsx` had
  already pinned this by experiment for promise loads, and a marked source is a promise load
  by another name. The pin list and suspense-situations.md §S10 both claimed otherwise and are
  corrected. What the server keeps is the `collectError` record, and the pin now covers a
  marked source reaching it with its code intact (the 404 signal).
- **Pin 8's "SSR-seeded cells under the double-mount" has no situation.** A hydration root
  does not double-mount at all — `hydrateRoot(<StrictMode>…)` builds one generation even with
  nothing suspending — so a wire-fed cell and a StrictMode generation never meet. Related and
  measured alongside it: the double-mount only reaches the levels the *initial mount* reached
  (a level behind a pending promise sees one generation), which is the smoke property's
  run-count range restated. Both are now in §S7, where a StrictMode test author will find them.
- **Pin 8's "unmount sweep" is not the sweep's real customer.** Dropping
  `sweepDetach(cacheRef.current?.buckets)` from the mandala's unmount left every StrictMode
  ledger balanced: the mandala's cleanup nulls the cache *before* its children's cleanups run,
  so a still-mounted Step calls its bucket dead and detaches everything itself. The sweep is
  load-bearing only for buckets whose Steps are **already gone** — the S8 window and the error
  slot. Pinned there instead (an island unmounting while a mid-tree source is pending), where
  removing it leaks the deep source and the kill fires.

Two harness notes, both of which cost real time:

- **S2's async-act rule is about any act that suspends, not just the mount.** A source
  transition can suspend the tree without looking like it — a ready source lets the waterfall
  reach a level whose hook load `use()`es a promise React has not seen — and under the sync
  `act(() => set(…))` that every `testSource` helper here uses, the retry is never delivered
  and the island sits on the loading slot forever. The older suites never tripped on it
  because their transitions reach no suspending level. Generalized in §S2.
- **A pin can pass its kill for the wrong reason.** Pin 4 (lazy read-sets) was written with a
  sync dependent and survived deleting `cell.reads = next.reads` outright: a sync value re-run
  swaps in a whole new cell built from `next`, read-set included, so that line is load-bearing
  only on the promise path. It now carries one dependent of each kind. The general lesson is
  the kill-note discipline's whole point — an unexecuted kill note is a guess.

### 2026-07-15 (post-close review) — the stale `pending` observation promoted to a fix

MF-02's first standing observation is resolved, on the user's call at the effort review: a
cascade-swapped source that errors now settles its swap on the way to the boundary
(`RefreshController.sourceErrored`, called from the resolver's source error branch), so the
key leaves `pending` instead of sitting there until a retry's `treeCommitted`. The contract
the fix defines: an error is a settled state, not an in-flight one — the error slot never
reads a key as re-fetching when nothing is. What legitimately stays in `pending` there is a
promise re-fetch still in flight when some other key errored the tree; it settles through
the controller's own `.then`, boundary or not.

Pinned in `scopeControls.test.tsx` (kill executed: dropping the `sourceErrored` call goes
red), and the command property's invariant 7 now asserts `pending` in the error slot too —
the guard MF-02 added is gone, and the model needed no change (it already treated an
erroring swap as settled).

The same review closed MF-03's open question: the command model **stays single-mode** —
a decision now, not a deferral. Promoting it would buy only run-budget precision under the
double-mount, at the cost of the model counting reached levels per generation, and the
smoke property's StrictMode variant already carries the lifecycle ledger there. Recorded in
[mandala-testing.md](docs/archive/mandala-testing.md) §"Explicitly later", with the
revisit condition.

## Per-item conventions

rati works in atomic commits on the current branch (its `CLAUDE.md`); prefix subjects with the
item id (`MF-01: …`), flip the record's `status: open` → `done` in the finishing commit, keep
`vp run rati#typecheck` + `vp lint` + `vp run rati#test` green, and push. Findings that are out
of an item's scope get a dated note appended here, not a silent fix.
