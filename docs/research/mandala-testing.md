# Mandala testing — what and how

Testing strategy for the mandala engine, written after the selective-refresh + SSR-sources
implementation ([directions-2026-07/mandala-refresh-and-ssr-sources.md](./directions-2026-07/mandala-refresh-and-ssr-sources.md)).
Three parts: the altitude rule that keeps coverage from freezing the engine, the deterministic
pins worth adding soon, and the design of the randomized (fuzz) foundation. The execution plan is
the `mandala-fuzz` effort (`docs/planned/mandala-fuzz/`); jnana's fuzz conventions
(`~/Sites/jnana/.claude/fuzz-testing.md`: fast-check, `fc.commands` models, kill-tests, budget /
long-mode / replay knobs) are the imported playbook.

## The altitude rule — test the contract, not the engine

The standing risk: mandala is mid-evolution (`keepStale`, `loadingDelayMs`, scope `.extend()`,
abort signals are all queued), and a test suite that pins mechanics locks those doors. Every
assertion must target the **observable contract** — what a component, a user, or an attached
source can tell — never the mechanism. Concretely:

**Fair game (the contract surface):**

- Which slot renders: loading / error / content, and *when* (all-or-nothing resolution; content
  implies every key ready).
- Rendered prop **values** and, where the contract promises it, their **identity stability**
  (an equal re-fetch keeps the old reference).
- The no-blank promise: a selective refresh never drops content that was on screen.
- Convergence: after everything settles, rendered values equal what a from-scratch resolution of
  the current inputs would produce — no stale derived value survives quiesce.
- Producer run counts, measured against **generations**: the contract is "at most one run per
  producer per inner-tree generation, plus modeled refresh re-runs" — a generation being each
  remount-inducing event that reached the producer's level (initial mount, an input change, a
  retry, a full refresh; StrictMode's dev double-mount counts as two). The smoke property's
  "exactly 1" is the one-generation special case; MF-02's model carries
  `runCount == generations + modeledReruns`. Plus "no spontaneous run while idle". Never raw
  exact counts — an engine that gets *lazier* must stay green; only one that gets *sloppier*
  (refetch loops, lost cascades, Suspense replays re-running loads) may fail.
- Lifecycle accounting at the source boundary: attach/detach balanced by teardown, no double
  attach of a live entry, `.provide()` dispose before its sources detach (observable by
  instrumenting the source/value the app hands in — still contract, not internals).
- `useScopeControls` surface: `pending` contents at quiesce points, refresh promise settlement.
- SSR: what the HTML carries, what the wire (`data`/`seeds`) carries, what runs (or must not run)
  client-side after hydration.

**Off limits (mechanism):** render counts, Step/bucket/cell shapes, effect ordering beyond the
dispose-before-detach contract, microtask timing, which internal path (`use()` vs value cell)
produced a render, exact `deepEqual` invocation counts. If an assertion would fail under a legit
optimization (batching two cascades, skipping an equal render, resolving lazier), it's below the
line — rewrite it or drop it.

## Deterministic pins — gaps worth closing soon

The 13 tests that landed with the implementation cover the happy paths and the headline
behaviors. The known gaps, in rough priority order (each is a small, focused test):

1. **Superseded refresh** — `refresh(key)` twice in flight; the older settle must be discarded
   (token guard). The race-guard invariant all three legacy generations carried, currently
   untested.
2. **Remount during in-flight refresh** — inputs change (or retry) while a re-fetch is pending:
   waiters settle, `pending` clears, the late settle applies nothing to the fresh tree.
3. **Transitive cascade + early cutoff** — `a → b → c`: `a` changes, `b` recomputes to an equal
   value → `c` untouched (the cutoff mid-chain); and `a` changes, `b` changes → `c` re-runs.
   Today only one-hop cascades are pinned.
4. **Lazy-read producers** — `(bag) => bag.x` styles: the read-set re-records per run, so a
   conditional read that flips (`flag ? bag.a : bag.b`) cascades correctly after the flip.
5. **Hydrated-cell refresh** — a server-hydrated key re-runs on direct `refresh(key)` and gains
   its read-set from that first run (before it: not a cascade target — pin the documented
   asymmetry).
6. **Concurrent refreshes of different keys** — `pending` holds both; settles in either order
   converge.
7. **SSR error paths** — a marked source erroring during `firstSettle` → the loading slot ships
   behind React's client-retry marker (**not** the error slot, as this list first predicted — the
   boundary never participates server-side, see S10) and the error reaches `collectError` with its
   code intact; client re-attaches fresh. A seed whose `hydrate()` throws → logged, source
   resolves live (degraded, not broken — at the cost of a hydration mismatch, since the server
   shipped seeded HTML).
8. **StrictMode accounting for the new machinery** — a refresh reaching the surviving run and
   swapping a source there stays balanced (the island suite pins StrictMode for the old
   lifecycle; the swap rework needs its own). The other two thirds this item first asked for
   turned out not to be StrictMode's: **SSR-seeded cells** never meet a double-mount (a
   hydration root doesn't get one — S7), and the **unmount sweep** is redundant with the Step's
   own cleanup at every unmount a mounted Step can see, so it is pinned where it is the only
   thing that can work — an island unmounting mid-S8-window, whose torn-down levels left
   sources attached with no cleanup of theirs ever to run again (pin 12's file).
9. **`data()` equals on cascade re-runs** — the per-load comparer gates cascaded re-runs of the
   dependent itself, not only direct refreshes.
10. **Re-suspension of committed content** — a `hook()` load returning a fresh pending promise
    hides committed content (Offscreen semantics) and cycles the subtree's effects; ledger stays
    balanced through hide/reveal, no double attach, content returns on settle, data producers
    don't re-run ([suspense-situations.md](../../packages/rati/src/__tests__/suspense-situations.md) S4).
11. **Unmount while suspended** — late settles into a discarded tree are inert (no throw, no
    log-noise, ledger balanced with never-attached sources at 0/0) (S5).
12. **Mid-tree source pending** — a committed source dropping to pending unmounts the levels
    below (unlike S4's hide); on recovery the cached cells render again **without producer
    re-runs**. Assert the loose contract only — whether deeper sources stay attached through the
    window is the engine's choice, not a promise (S8).

Each pin lands with a **kill note** (jnana discipline): the one-line source mutation that must
make it fail, executed once at authoring and reverted. The Suspense-produced situations behind
pins 10–12 (and the test-harness rules they imply — the async-act mount requirement above all)
are cataloged in
[suspense-situations.md](../../packages/rati/src/__tests__/suspense-situations.md)
(`packages/rati/src/__tests__/`), which lives with the tests.

## The fuzz foundation — model-based testing over generated scopes

The deterministic suite pins known behaviors; the fuzz suite searches the space of *scope shapes ×
event interleavings* where resolver bugs actually live (the jnana experience: ordering and
interleaving bugs are found one review at a time unless made searchable). Tooling:
`fast-check` + `@fast-check/vitest`, an `fc.commands` model, budget/replay conventions copied
per-suite (`fuzz(n)`, `FUZZ_RUNS`, `FUZZ_LEVEL` via `byLevel`, `FUZZ_SEED`) — jnana's layout,
ported. Suite home: `packages/rati/src/__tests__/fuzz/`.

### Generated scopes — the spec arbitrary

A run generates a small **scope spec**, then the harness builds a real scope + island from it:

```ts
type KeySpec = {
    key: string;                     // unique across the scope
    level: number;                   // 1..4 levels, 1..3 keys each (grown by FUZZ_LEVEL)
    kind: 'value' | 'promise' | 'source';
    reads: string[];                 // ⊆ keys of strictly earlier levels
    payload: 'fresh' | 'stable';     // re-run yields a new value vs a deep-equal one
};
```

Producers are **instrumented and deterministic**: each computes its value from its reads' current
values plus a generation counter (bumped per run only for `payload: 'fresh'`), so the model can
compute the expected value of every key by the same formula. Promise producers return
harness-held deferreds; source producers return harness-held controllable sources — commands
settle them in fast-check-chosen orders. Hook loads stay out of v1 (they are pass-through by
construction); `data(fn, { equals })` enters as a spec variant once the base model is green.

### The model

A plain-JS mirror: per key `{ status, value, runCount, gen }` plus the scope-level derivations —
which slot must be showing, the expected `pending` set, the attach ledger. No React, no engine
code: the model *is* the contract's semantics, small enough to audit by eye.

### The command alphabet (v1)

- `settle(key)` / `reject(key)` — resolve one held deferred (initial load or in-flight refresh).
- `sourceReady(key, gen)` / `sourcePend(key)` / `sourceError(key)` — drive a controllable source.
- `refresh(key)` — through `useScopeControls` (a probe component), promise loads only.
- `refreshAll()` — the full re-resolve; model resets to initial-loading semantics.
- `changeInput()` — bump an island input; remount semantics, in-flight bookkeeping settles.

Every command runs inside `act`; invariants are asserted after each command; a **quiesce tail**
(settle everything held, flush) closes every run before the convergence check. The island
unmounts in a `finally` and the lifecycle ledger is asserted balanced there — a leak fails the
run even when every mid-run assert passed.

### Invariants (all contract-level, per the altitude rule)

1. **Slot correctness** — rendered slot matches the model at every step.
2. **No-blank** — with last-ready content and only selective refreshes in flight, the content
   stays rendered (the loading slot is legal only for initial / full re-resolves).
3. **Convergence at quiesce** — every rendered value equals the model's recomputation; this is
   the soundness property that catches lost cascades, stale dependents, and wrong-order settles.
4. **Identity stability** — a `stable`-payload re-fetch leaves the rendered reference unchanged.
5. **Run-count upper bounds** — per producer: ≤ 1 + direct refreshes + times-a-read-changed; and
   zero new runs across commands that held nothing pending (no refetch loops).
6. **Lifecycle ledger** — attach/detach balanced; no second attach of an already-attached entry;
   at final unmount everything detached.
7. **`pending` agreement** — at quiesce points, `pending` equals the model's in-flight set.

**Non-vacuity:** the command arbitrary guarantees at least one `refresh` with a `fresh` payload
per sequence (or the run is discarded), and the suite counts refresh-with-change occurrences
across the property — a green run that never exercised the machinery is a failure of the harness,
not a pass.

### Kill register (executed at MF-04; recipes on file)

The harness ships only after each kill — a one-line, bug-shaped mutation of the engine — has been
run red, shrunk, and reverted. All six below were executed against the landed suite and reverted;
mutations never merge. Each recipe names the site, the mutation, the command, and the failure
shape, so re-verification is a copy-paste.

**Every recipe pins `FUZZ_SEED`.** The default budget (`fuzz(100)`) does not reach every kill on
every seed — kill 1 survives ~10% of unpinned seeds and kill 3 is rarer still (~1 case in 70 at
depth). That is a property of the *search*, not of the invariants: each kill dies deterministically
under its pinned seed, and a widened run (`FUZZ_RUNS=2000`) finds all six unpinned. Re-verify with
the seed; treat an unpinned green as no evidence.

The command below is the same for every kill (`P` = the commands property):

```
FUZZ_SEED=<seed> vp run rati#test src/__tests__/fuzz/mandala.commands.fuzz.test.tsx
```

1. **Equality gate forced to "unchanged"** — `refresh.ts` `settled()`: `const changed = false`.
   `FUZZ_SEED=1` → red on case 51. Fails **3 — convergence** at quiesce: the settle never swaps
   the cell to a value cell, so both the refreshed key *and* its dependents render the old
   generation. Shrinks (22x) to a 2-level scope with `k1_2` reading `k0_0`, `refresh#0, settle#0`
   on a warm start: `k0_0#1() → k0_0#0()`, `k1_2#0(k0_0#1()) → k1_2#0(k0_0#0())`.
2. **`markDependents` limited to the next level** — `refresh.ts`: loop bound
   `Math.min(levelIndex + 2, …)`. `FUZZ_SEED=1` → red on case 7, **3 — convergence**. Shrinks
   (24x) past the chained a→b→c cascade to something sharper: a *level-skipping* read — `k2_0`
   (level 2) reads `k0_0` (level 0), `sourceBump#0` — so the dependent one level down is fine
   and only the skipped-over one is stale. `markDependents` must walk every later level, not the
   adjacent one.
3. **Refresh token guard dropped** — `refresh.ts` `settled()`: drop `cell.refreshing?.token !==
   token`. `FUZZ_SEED=7` → red on case 4 (**note: survives seeds 1, 2, 3, 42** — the narrowest
   kill of the six). Fails mid-run, not at quiesce: `SettleStale`'s own **values unmoved** assert.
   Shrinks (16x) to `refresh#0, refreshInFlight#0, settleStale#0` — the superseded promise's
   settle applies (`k0_0#0() → k0_0#1()`) where the contract says it is inert.
4. **Stale-while-refetch removed** — `resolver.tsx` `processDirtyCells()`: `bucket.cells.set(key,
   {kind:'promise', promise: next.promise, …})` before `trackRefresh`. `FUZZ_SEED=1` → red on
   case 1. Fails **2 — no-blank**, mid-run: `sourceBump(k1_1): slot: expected 'loading' to be
   'content'`. Shrinks (19x) to a cascade-driven re-run rather than an explicit `refresh` —
   `k2_0` (promise) reads the bumped source `k1_1`, the level re-suspends on the fresh promise
   and the loading slot replaces still-good content.
5. **`trackReads` returns an empty set** — `refresh.ts`: `return { proxy, reads: new Set() }`.
   `FUZZ_SEED=1` → red on case 1. **Fails differently than this register once predicted**: not
   convergence but `assertProvideRebuild` — *"a changed value must rebuild the provided value"* —
   and consistently so (seeds 1, 2, 3, 7 all land there). The `.provide()` factory reads every
   key, so it is the universal dependent and the read-set's canary: an empty set stops the leaf
   rebuilding mid-run, well before quiesce gets a look. The `withProvide` variant is what carries
   this kill.
6. **Swap-aware detach inverted** — `resolver.tsx` detach effect: drop the
   `if (bucketIsLive && bucket.sources.includes(entry)) continue` skip. `FUZZ_SEED=1` → red on
   case 7. Fails **6 — the lifecycle ledger**, mid-run: *"k2_0#1 feeds the rendered content while
   detached"*. Shrinks (28x) to the collateral case — `k2_2` (a source reading the bumped `k0_2`)
   swaps, and because a bucket is per *level*, replacing its `sources` array detaches its
   untouched sibling `k2_0`, which is still feeding the render. Caught by the commands property;
   the smoke property (incl. its StrictMode variant) stays green, so the ledger's mid-run bounds
   — not its teardown balance — are what bite here.

**The counters gate (MF-02 §5).** Neutering the guarantee — the `Refresh`/`RefreshInFlight` verbs
removed from `commandsArb` — leaves every other invariant green and fails exactly one assert:
`no refresh ever changed a value: expected 0 to be greater than 0`. Without the counter that run
is a vacuous pass, which is the counterfeit-provider failure mode; with it, the suite complains.

### Budgets

`fc.commands` runs mount a real island per case: default `numRuns` small (~25, `fuzz(25)`),
`maxCommands` grown by `FUZZ_LEVEL` (`byLevel(8, 4)`), deep runs via `FUZZ_RUNS=…` manually or
a nightly lane later. Fast by default so `vp run rati#test` stays ~seconds.

## Explicitly later (so this doesn't sprawl)

- **Router fuzz** — the second fuzz target (navigation command alphabet over `RouterStore` +
  memory history + route islands); designed as its own effort once the mandala foundation proves
  the harness pattern.
- **SSR under fuzz** — `prerender` per fuzz case is expensive and the SSR paths are narrow;
  they stay deterministic (part 2 §7) until evidence says otherwise.
- **`fc.scheduler` microtask interleaving** — the step-3 jnana technique; relevant once
  controller notifications/batching get more concurrent. Not before.
- **Hydration as a fuzz dimension** — deterministic pins first; promote to a fuzz variant only if
  the pins keep finding neighbors. StrictMode is no longer on this list: MF-03 promoted it for
  the *smoke* property (the double-mount is where the lifecycle ledger earns its keep). The
  command model stays single-mode for now — see the effort's MF-03 note for what promoting it
  would cost.
