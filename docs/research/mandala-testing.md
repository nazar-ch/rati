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
7. **SSR error paths** — a marked source erroring during `firstSettle` → error slot in the HTML,
   client re-attaches fresh; a seed whose `hydrate()` throws → logged, source resolves live
   (degraded, not broken).
8. **StrictMode accounting for the new machinery** — refresh mid-double-mount, SSR-seeded cells,
   and the unmount sweep: attach/detach stay balanced (the island suite pins StrictMode for the
   old lifecycle; the swap/sweep rework needs its own).
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

### Kill register (executed once at authoring, then recipes on file)

The harness ships only after each planned kill has been run and reverted — proof it bites:

- equality gate forced to "unchanged" → convergence fails (stale dependents survive).
- `markDependents` limited to the next level only → transitive-cascade convergence fails.
- refresh token guard dropped → the superseded-settle interleaving fails.
- stale-while-refetch removed (swap the pending promise in immediately) → no-blank fails.
- `trackReads` returning an empty set → cascade never fires, convergence fails.
- swap-aware detach inverted (always detach on `[sources]` change) → the lifecycle ledger fails.

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
- **Hydration/StrictMode as fuzz dimensions** — deterministic pins first; promote to fuzz
  variants only if the pins keep finding neighbors.
