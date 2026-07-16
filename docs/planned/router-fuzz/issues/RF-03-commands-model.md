# RF-03 — fc.commands model: the navigation alphabet + behavioral invariants

area: packages/rati/src/__tests__/fuzz
needs: RF-02, RF-06
disposition: —

## Problem

The smoke property (RF-02) covers forward navigation only. The bugs worth searching for
live in traversal interleavings: POP landing on a skip-marker entry, redirects racing
replaces, state-only entries stepped through back/forward, shallow navigations stacked on
each other. This item turns the foundation into an `fc.commands` suite over the real
`RouterStore` (memory history) against the RF-02 model.

## Scope

1. **The command alphabet** (each an `fc.Command`; `check` gates causality — e.g. `back`
   only when the model's index > 0):
   - `navigateRef` / `navigatePath` — push by route reference / literal path;
   - `replaceRef` / `replacePath`;
   - `navigateShallow` / `replaceShallow` — `{ keepCurrentRoute: true }`;
   - `navigateWithState(state)` — per-entry state from a small pool, including two
     shallow-equal-but-not-identical objects (the `shallowEqualState` seam);
   - `back` / `forward` / `go(n)` — the RF-02 traversal;
   - `setSearchParams` (push and replace modes);
   - `toRedirectRoute` — navigate into a redirect (single hop, into the cycle pair, and
     onto a self-target — a loop of length 1 once RF-06 lands its semantics).
2. **Invariants after every command** (the altitude bar from RF-02's review):
   1. *Rendered agreement* — the mounted route (name + params, decoded) ≡ the model's
      match of the model's current entry.
   2. *URL agreement* — `history.location` path/search/hash ≡ the model entry.
   3. *State agreement* — `router.state` ≡ the entry's state; traversal between two
      same-URL entries differing in state re-resolves (the mount probe shows it).
   4. *Remount discipline* — a remount happened **iff** the model says the command
      re-resolves: shallow navigations don't; POP onto a stale skip marker does; a
      same-URL same-state replace doesn't. Observed through mount effects.
   5. *Redirect discipline* — entering a redirect route lands on its target with no
      extra back entry (the model followed a replace); the cycle pair stops at the depth
      cap and renders the last route (and the property tolerates the logged error there).
   6. *Notification coherence* — the store's version is strictly monotonic and consumers
      re-read (a probe reading `search`/`hash` never renders a stale value at quiesce).
3. **Non-vacuity counters**: across the run set, assert traversals actually happened,
   at least one stale-skip-marker POP re-resolved, and the redirect pair was entered —
   the counters gate from mandala-fuzz, same reasoning.
4. **The teardown tail**: unmount in `finally`; after `RouterStore.dispose()`, driving
   the injected memory history produces no render — the store detached itself (the kill
   is dropping `unlistenHistory()`). Deliberately *not* asserted here: the
   created-history DOM detach (RF-01.4). The harness injects its history, so
   `dispose()` never reaches `history.dispose()` — and RF-01's finding (README,
   2026-07-16) showed that leak has no store-level shadow anyway; its pin lives at the
   History surface in `webRouterCore.test.ts`, where it bites.

## Boundaries

- The altitude rule binds: no `pathCounter` values, no marker-string parsing, no listener
  counts in asserts — remounts are observed through effects, staleness through renders.
- Kill executions are RF-05's, but encode with the register in mind: an invariant that
  obviously couldn't catch its kill is mis-encoded.
- No engine changes; real bugs found → minimal deterministic pin + checkpoint report.

## Verify

- Fuzz suite green at default budget and `FUZZ_RUNS=500`; replay recipe works
  (`FUZZ_SEED` pins the failing case).
- `vp run rati#typecheck:test` + `vp lint` green; default whole-suite runtime ~seconds.
