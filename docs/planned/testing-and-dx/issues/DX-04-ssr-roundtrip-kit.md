# DX-04 — SSR round-trip kit

area: packages/rati/src/testing/, docs
needs: DX-01 (the entry + API style)
disposition: cut 2026-07-19 from the survey (README §Survey) — the research doc missed it;
             added at cut by maintainer's more-scope call

## Problem

Testing SSR means: drain `react-dom/static` `prerender` into a string, wire
`createHydrationCollector`/`HydrationProvider`, then `hydrateRoot` the output and assert
the client didn't re-run the loads. That loop is hand-rolled across rati's `islandSsr*`,
`router/hydration`, and `ssr/*` suites (~20 files touch it), and a public SSR consumer has
no way to test their pages' hydration at all short of reinventing it.

## Scope

1. **`prerenderToString(element, options?)`** — the drain loop
   (`islandSsrSources.test.tsx:18` is the reference implementation), returning the HTML
   string. Thin; exists so nobody writes a reader loop in a test again.
2. **A round-trip harness** — the composed flow: collected server render (collector +
   provider wiring) → dehydrated payload → client `hydrateRoot` against that HTML with the
   payload fed back → a handle to assert on (no-mismatch, whether loads re-ran, the
   rendered result). Shape decided in-item against the existing suites; the canonical
   assertions it must make easy: "hydrates without re-running the async load" and
   "hydration mismatch fails the test loudly" (React logs mismatches — the harness turns
   them into failures rather than console noise).
3. **Route-level variant:** compose with DX-03's `createTestRouter` for `prepareRoute`-based
   round-trips (the `router/hydration` suites' shape) — a documented composition, a helper
   only if composition is ugly.
4. **Prove it:** convert one `islandSsr*` suite and one `ssr/` suite in-item.
5. **Docs:** reference.md section + a worked example (the consumer story: "test that your
   page hydrates without refetching").

## Boundaries

- jsdom-environment only, documented as such (that is where every existing SSR test runs);
  no real-server harness, no `renderApp`/HTTP-level testing — `serve`/`requestHandler`
  suites keep their own setups.
- No streaming, mirroring the engine's non-goal.
- The mismatch-to-failure behavior must be scoped to the harness (an opt-out flag) so
  deliberate-degradation tests (the SSR-error baseline's loading-slot fallback) can still
  assert the degraded path.

## Verify

- `yarn ci` green; converted suites keep their assertions.
- The documented example runs verbatim: an async-load island round-trips with zero client
  re-runs (counter asserted through a `controllableSource`/`deferred` producer).
- Negative pin: a deliberately mismatched tree makes the harness fail with a message naming
  the mismatch (and the opt-out flag suppresses it).
