# DX-02 — `renderIsland` harness + slot readers

area: packages/rati/src/testing/, docs
needs: DX-01 (the entry + API style)
disposition: cut 2026-07-19 from dx-and-tooling.md §Test utilities + the survey

## Problem

Rendering an island in a test means wiring providers, mounting, driving resolution, and
reading which slot (content / loading / error) is showing — hand-inlined across the
deterministic mandala suites, while the complete version sits in the fuzz harness
(`__tests__/fuzz/scopeHarness.tsx`: mount + `readSlot`/`readContent`/`visibleNode` +
testids). Consumers get nothing at all: testing a component that lives under an island means
reinventing this from scratch.

## Scope

1. **`renderIsland(islandOrConfig, { props })`** — mounts an island (or a scope + component
   pair) with whatever provider wiring islands need, returns a handle: the container/query
   surface, a way to await settled resolution, unmount/cleanup. Exact surface designed
   in-item against the real usage in the mandala suites — the harness must make the
   *existing tests* shorter, which is the API test.
2. **Slot readers** — promote `readSlot`/`readContent` (or a cleaner equivalent decided
   against DX-01's style): "which slot is visible, and what does it say". Decide whether
   testids stay the mechanism or the reader inspects structure; testids leaking into public
   API is a smell worth designing away if cheap.
3. **Awaiting resolution:** the harness composes with `deferred`/`controllableSource`
   (DX-01) — the canonical test is: mount with a deferred load → assert loading slot →
   resolve → `flush` → assert content. That flow is the documented example.
4. **Scope controls integration:** the handle exposes or composes with `useScopeControls`
   testing (refresh from the test side) — at minimum the documented pattern; a helper only
   if the pattern is ugly without one.
5. **Prove it:** convert two mandala suites in-item (e.g. `island.test.tsx` +
   `suspenseEdges.test.tsx` partially) — full sweep is DX-05's.
6. **Docs:** reference.md `rati/testing` section grows the harness + a worked example.

## Boundaries

- Router-mounted islands (route islands) are DX-03's harness; this one is standalone
  `island()` only — but design the return shape so DX-03 can reuse it.
- SSR rendering is DX-04's.
- The fuzz `scopeHarness` keeps its model-wired drivers; it may re-export from the public
  core but its fuzz-facing surface doesn't change.

## Verify

- `yarn ci` green; the two converted suites keep their assertion count.
- The documented example (deferred → loading → resolve → content) runs verbatim as a test.
- If SI-03 (scope-and-island effort) has landed by execution time: the harness surfaces
  `phase`/`isStale` reading without extra wiring; if not, note it as a follow-up line in the
  README, don't block.
