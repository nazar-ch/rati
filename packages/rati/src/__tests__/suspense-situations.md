# Suspense situations — the catalog the mandala tests cover

React's Suspense machinery produces more distinct situations than "pending shows a
fallback", and several of them are exactly where resolver bugs (or test-harness lies) hide.
This catalog enumerates them for the mandala: what React does, what the engine must
guarantee (the contract — [docs/research/mandala-testing.md](../../../../docs/research/mandala-testing.md)
§"The altitude rule" binds what tests may assert), and which suite owns the coverage.
It lives with the tests on purpose: when a suite around here behaves strangely, check this
list before blaming the engine.

## S1 — Suspend-and-replay during resolution

A Step that `use()`es a pending promise throws it; React discards the render and replays
the whole Step body when the promise settles. Render-phase work repeats freely.
**Contract:** producers run once per inner-tree generation regardless of replays — the
bucket cache on the mandala's committed ref exists for exactly this (a Step-local cell
would re-run its load and re-suspend on a fresh promise forever).
**Coverage:** the smoke property's exactly-one-run assert (`fuzz/mandala.smoke.fuzz.test.tsx`);
`island.test.tsx` waterfall tests.

## S2 — Retry delivery is environment-sensitive (test-facing)

The Suspense retry after a resolution is not synchronous with the resolving `act`, and —
found by the smoke property's first run — an island mounted under testing-library's *sync*
act (`render()` bare) **never** receives the retry at all: it stays on the loading slot
forever. Mount inside `await act(async () => …)`; after a settle, flush one extra
`await act(async () => {})` before asserting (a fixed flush count — never poll-until-green).
**Coverage:** documented at the smoke property's mount site; every suite here follows the
pattern. This is a harness rule, not an engine contract.

## S3 — Multiple pending promises in one level

The resolve loop suspends on the *first* pending promise; later cells of the same level
aren't reached in that render — but their producers already ran at bucket build (build is
a separate loop). Settling promises one by one replays the Step once per settle.
**Contract:** all of a level's producers run when the level is reached (not lazily as the
loop reaches them), exactly once. **Coverage:** smoke property (multi-key levels with
generated settle orders exercise every interleaving).

## S4 — Re-suspension of committed content

If a *committed* Step suspends again — reachable today only through a `hook()` load
returning a fresh pending promise on a later render — React does not unmount the content:
it hides it (Offscreen semantics), destroys the subtree's effects, and re-runs them on
reveal. The mandala's attach loop is idempotent by the `detach !== null` guard, so
hide/reveal cycles must not double-attach or leak.
**Contract:** ledger stays balanced through hide/reveal; content returns after the promise
settles; no producer re-runs (data cells are cached — only the hook load itself re-ran).
**Coverage:** deterministic pin (strategy doc §pins #10, MF-05). Deliberately *not* in the
fuzz alphabet: hook loads are out of the v1 spec.
**Note:** selective refresh never triggers S4 by design — a refreshed cell keeps rendering
its old settled promise/value and swaps to a value cell on settle, precisely so committed
content cannot re-suspend (the no-blank invariant is the fuzz-side guard on this).

## S5 — Unmount while suspended; late settles

The island unmounts (navigation) while loads are in flight; promises settle into a
discarded tree.
**Contract:** late settles are inert — no throw, no log, no state write anywhere
observable; the ledger balances (sources of never-committed levels were created but never
attached: 0 attaches / 0 detaches is balanced). **Coverage:** the fuzz `finally` unmounts
whatever state the run ended in — MF-02's command sequences may end mid-flight on purpose
(a fraction of runs skips the quiesce tail), which exercises this continuously; plus
strategy-doc pin #11.

## S6 — Input change while suspended

Inputs change before the first resolution commits: the inner tree remounts (`treeKey`),
old buckets are dropped, producers run again with the new inputs — a new *generation*.
The old generation's suspended render never committed, so its sources never attached.
**Contract:** runs-per-generation stays ≤ 1; the old generation leaks nothing.
**Coverage:** MF-02's `changeInput` command; the generation-based run-count model
(strategy doc §invariants).

## S7 — StrictMode double-mount interplay

Dev StrictMode mounts → cleans up → remounts; the mandala drops its cache on the fake
unmount and rebuilds, so producers legitimately run once per StrictMode generation (twice
total), and the unmount sweep must release the first generation's attachments.
**Contract:** per-generation accounting holds; ledger balanced through the double-mount.
**Coverage:** MF-03's StrictMode smoke variant; strategy-doc pin #8.

## S8 — Mid-tree source pending is *not* Suspense (the unmount asymmetry)

A committed source dropping ready → pending renders the loading slot as ordinary children:
the levels *below* it unmount for real (their `.provide()` values dispose), unlike S4's
hide. Their data cells stay cached in the mandala-held buckets, and — since the Step
teardown keeps entries the live bucket still holds — their sources *currently stay
attached* through the pending window (no detach/attach churn; everything releases at
island teardown).
**Contract (deliberately loose, per the altitude rule):** no double-attach, ledger
balanced at teardown, deeper producers do **not** re-run when the source recovers. Whether
sources stay attached through the window or cycle is engine's choice — tests must not pin
either (the churn-free behavior is an implementation nicety, not a promise).
**Coverage:** strategy-doc pin #12 (recovery without producer re-runs); the fuzz ledger
bounds it structurally (MF-03).

## S9 — `use()` instruments foreign promises

React mutates thenables it `use()`es (status fields) and *suspends once even on an
already-settled promise it hasn't seen*. Two design consequences the tests guard:
a settled refresh swaps in a **value cell** rather than a fresh settled promise (else
every refresh would flash the loading slot — the no-blank invariant is the tripwire), and
harness deferreds are per-cell (sharing one promise object across cells would entangle
React's instrumentation).
**Coverage:** no-blank invariant (scopeControls tests now, MF-02 fuzz); kill #4 in the
MF-04 register (defeat stale-while-refetch → no-blank fails).

## S10 — Server prerender

`react-dom/static` `prerender` awaits Suspense: promise loads and SSR-marked sources
(wrapped into promises by `firstSettle`) resolve server-side; a rejection reaches the
boundary and the error slot ships in the HTML; unmarked sources stay pending (fallback in
the HTML). There are no client-side retries of a server suspension — hydration
short-circuits values/seeds instead.
**Coverage:** `islandSsr.test.tsx`, `islandSsrSources.test.tsx`; error-path pin
(strategy doc §pins #7).
