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

The rule is about **any act that suspends**, not just the mount — MF-05's pin 10 relearned
it one transition later. A source transition can suspend the tree without looking like it:
a ready source lets the waterfall reach a level whose load `use()`es a promise React has
not seen (an unsettled load, or a `hook()` load's fresh promise — S9: React suspends once
even on an already-settled promise). Driven by a sync `act(() => source.set(…))` — which is
what most `testSource` helpers here do — that retry is lost and the island sits on the
loading slot forever, exactly like the bare-`render()` mount. Where a transition can reach
a suspending level, drive it with `await act(async () => …)`; where it cannot (every level
below resolves from cells already built), the sync helper is fine, which is why the older
suites never tripped on this.
**Coverage:** documented at the smoke property's mount site; `suspenseEdges.test.tsx`'s
source helper drives async transitions for this reason. A harness rule, not an engine
contract.

## S3 — Multiple pending promises in one level

The resolve loop suspends on the *first* pending promise; later cells of the same level
aren't reached in that render — but their producers already ran at bucket build (build is
a separate loop). Settling promises one by one replays the Step once per settle.
**Contract:** all of a level's producers run when the level is reached (not lazily as the
loop reaches them), exactly once. **Coverage:** smoke property (multi-key levels with
generated settle orders exercise every interleaving).

## S4 — Re-suspension of committed content

If a *committed* Step suspends again — through a `hook()` load returning a fresh pending
promise on a later render (S11 is the other way in) — React does not unmount the content:
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
total), and the first generation's attachments must be released.
**Contract:** per-generation accounting holds; ledger balanced through the double-mount.

Two limits on *which* mounts get one, both measured by MF-05's pin 8 and worth knowing
before writing a StrictMode test (or reading a green one as evidence):

- **Only the levels the initial mount reached.** A level behind a pending promise is first
  built when that promise settles — after the double-mount is over — so it sees one
  generation however deep the scope is; level 0 still runs twice. A test that wants a
  *dependent* level doubled needs its upstream to resolve synchronously. (Same fact as the
  smoke property's run-count *range*, from the other side.)
- **A hydration root does not double-mount at all.** `hydrateRoot(<StrictMode>…)` builds
  exactly one generation even where nothing suspends. So a cell that came off the wire and
  a StrictMode double-mount never meet: the payload is read once, and there is no
  "SSR-seeded cell under the double-mount" situation to test.

**Coverage:** MF-03's StrictMode smoke variant; `strictModeLifecycle.test.tsx` (pin #8).

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
(wrapped into promises by `firstSettle`) resolve server-side; unmarked sources stay
pending (fallback in the HTML). There are no client-side retries of a server suspension —
hydration short-circuits values/seeds instead.

A rejection — a promise load's or a marked source's — does **not** reach the error slot,
though this catalog said so until MF-05 pinned it: `prerender` *resolves*, React emits the
**loading** slot behind its "switched to client rendering" marker, and the client re-runs
the load. The error boundary never participates server-side, so the error slot is a
client-only surface. What the server keeps is rati's `collectError` record — its input for
the response status (`not-available` → 404) before that degraded 200 goes out.
**Coverage:** `islandSsr.test.tsx`, `islandSsrErrors.test.tsx` (which pinned the promise
half by experiment first), `islandSsrSources.test.tsx` §error paths (strategy doc §pins #7).

## S11 — A suspending remount hides the old content (test-facing)

A new generation (input change / retry) re-keys the inner tree, and the fresh tree suspends
on its first load. React does **not** unmount the outgoing content while it waits: it keeps
it mounted and hides it — `style="display: none !important"` — and renders the fallback
*next to it*. So mid-remount the DOM holds **both** slots:

```html
<div data-testid="content" style="display: none !important;">a0/bee</div>
<div data-testid="loading">loading</div>
```

The user sees the loading slot; a test asking `querySelector('[data-testid=content]')` — or
`screen.getByText` for a value that was on screen before — sees the stale one and calls it
content. That is a **harness rule, not an engine contract**: read the slot through visibility
(walk up from the marker looking for `display: none`), never through presence alone. The fuzz
harness's `readSlot`/`readContent` do exactly that — without it, the command property called
every suspending remount "content" and would have excused a genuine loading-slot flash.
This is also the second way into S4's Offscreen semantics, so the hidden tree's effects are
destroyed and re-run on reveal, and the ledger rules there apply.
**Coverage:** `fuzz/scopeHarness.tsx` (`visibleNode`); the command property's slot invariant.

## S12 — A suspended Step never commits, so its level's sources are inert

The resolve loop suspends on the *first* pending promise it reaches, which discards the
render — so the Step never commits, its layout effect never runs, and **its level's sources
are never attached and never subscribed**. Two consequences, both latent rather than wrong:
an errored source in a level that still has a promise in flight changes nothing on screen,
and a promise rejection sitting behind an unsettled promise is not reached either. Both
surface later, when the loop finally gets that far (React replays the Step body on each
settle). *When* the engine notices is loop order — mechanism, so tests must not pin it: the
fuzz alphabet only rejects a load where the answer is unambiguous (an in-flight re-fetch,
which fails through the controller rather than through `use()`, or the last held load of a
level). The related freeze is S8's: while a mid-tree source is pending the levels below are
unmounted, so a swapped source's `pending` bookkeeping — done in render — cannot progress
until it recovers.
**Coverage:** `fuzz/model.ts` (`rejectable`, `settleable`); strategy-doc pin #11.
