---
area: packages/rati/src/router/history.ts, packages/rati/src/__tests__/fuzz
needs: RF-01
status: done
disposition: —
---

# RF-02 — fuzz foundation: traversable history, routes arbitrary, reference model, smoke

## Problem

The router's fuzz dimension is *traversal*: sequences of push/replace/back/forward over a
generated route table. Nothing today can drive that deterministically —
`createMemoryHistory` holds a single location (its doc: "back/forward navigation is not
modeled") and the existing POP tests hand-roll `replaceState` + `PopStateEvent`. This item
builds the four foundation pieces and sets the altitude bar the rest of the effort encodes
against (mirroring MF-01's calibration role).

## Scope

1. **Traversable memory history** (product code, not test-only): `createMemoryHistory`
   grows a real entry stack — `push` truncates the forward tail and appends, `replace`
   swaps in place, and a new `go(delta)` (with `back`/`forward` sugar if cheap) moves the
   index and emits `POP` with the entry's own `state` and `key`. This is the documented
   gap filled where non-DOM hosts and tests both benefit; the browser history stays the
   browser's. Deterministic pins for the stack semantics ride along here.
2. **The routes-table arbitrary**: generated tables mixing static paths, single- and
   multi-param paths (including a prefix-colliding name pair — RF-01's fix under fuzz),
   redirect routes (object / string / function targets, one cycle pair), a `*` catch-all,
   and an optional `basename`. Params draw from a value pool that includes
   URL-hostile strings (spaces, slashes, percent signs) — the codec under fuzz.
3. **The reference model**: pure JS, no router imports (the altitude rule made structural,
   as in the mandala model). State = an entry stack (path/search/hash/state) + an index;
   matching = first route whose pattern matches, redirects followed to a depth cap. It
   answers: the expected active route (name + decoded params), the expected URL, the
   expected `state`, and whether the last command should have remounted.
4. **The smoke property**: for any generated table and any sequence of `navigate`/
   `replace` calls (no traversal yet — that's RF-03's alphabet), the rendered route, URL,
   and params agree with the model at every step; a final catch-all check that no
   navigation ever left the Router rendering a stale route. Rendered-route observation via
   a probe component logging `(name, params)` per mount — remount discipline is observable
   through mount effects, never through counters.
5. **Budgets**: same knobs as the mandala suite (`fuzz(n)`, `FUZZ_RUNS`, `FUZZ_LEVEL`,
   `FUZZ_SEED` via `arbitraries.ts` — reuse it or extract the shared helpers rather than
   copying).

## Boundaries

- This is the **calibration gate**: the user reviews the invariant altitude (what the
  probe observes, what the model predicts) before RF-03/RF-04 fan out.
- The mandala doesn't participate: route components here are plain (no scopes) — data
  resolution under navigation is the mandala suite's ground, already covered. A single
  island-bearing route may appear in RF-03's alphabet as a smoke check, no more.
- No SSR: `prepareRoute` stays with its deterministic suite.

## Verify

- `vp run rati#test` green at default budget; `FUZZ_RUNS=500` green; whole-suite runtime
  still ~seconds (the fuzz stage of `yarn ci` carries the deep run).
- The memory-history pins go red with the stack logic broken (kill executed once, noted).
- `vp run rati#typecheck` + `vp run rati#typecheck:test` + `vp lint` green.
