# DX-03 — `createTestRouter` + the stores-injection seam

area: packages/rati/src/testing/, docs
needs: DX-01 (the entry + API style); the stores-container work landed (assumed at cut —
       reconcile against what shipped)
disposition: cut 2026-07-19 from dx-and-tooling.md §Test utilities + the survey

## Problem

Two seams, one item because they wire together:

- **Router:** `createMemoryHistory` + `new RouterStore(routes)` + provider + `<Router>` is
  repeated inline across ~20 rati router test files; Jnana never manages it at all — five
  files stub the router surface with `{ navigate: vi.fn(), … }` objects and two files
  `vi.mock('rati')` to neuter `Link` ("requires a real RouterStore"). The full version
  exists in `__tests__/fuzz/routerHarness.tsx`.
- **Stores:** ten Jnana component tests inject fake containers through
  `GenericStoresContext.Provider` with `as unknown as GlobalStores` casts. The
  stores-container effort internalizes that context — the pattern loses its seam, and the
  sanctioned replacement must ship here.

## Scope

1. **`createTestRouter(routes, { url, state? })`** — memory history + router + the
   provider wiring, returning `{ router, … }` plus render integration (compose with
   DX-02's harness shape for rendering `<Router>` trees). Traversal drivers (`back`/
   `forward`) ride the RF-02 memory history's real entry stack. Dispose handled by the
   harness (the RF-01 lesson: histories leak listeners when nobody disposes).
2. **The stores seam.** A public way to render a tree with a **partial** stores container —
   the shape Jnana's ten files build by hand, minus the cast. Design against the
   post-container surface (`StoresProvider` / `createStoresHook` / the table-blind router
   type): likely `renderWithStores(ui, { stores: Partial<…> })` or a provider component the
   test composes; decide in-item. The typed hole ("I only provide the two stores this
   component reads") is the point — the cast dies.
3. **`Link` under test:** with a test router mounted, `Link` works — the two Jnana
   `vi.mock('rati')` files are the acceptance case; the documented example renders a
   component with `Link`s against `createTestRouter` and asserts navigation.
4. **Prove it:** convert `router/routerIsland.test.tsx` and one `renderWithRouter` variant
   file in-item.
5. **Docs:** reference.md section grows both seams with the Jnana-shaped example (partial
   stores + fake-free router).

## Boundaries

- The fuzz `routerHarness` keeps its model/asserts; only the wiring core is shared.
- No SSR (`prepareRoute`) harness here — DX-04 owns the server side.
- Don't re-expose anything the container effort internalized — the seam is a new, designed
  surface, not a re-export of `GenericStoresContext`.
- If the shipped stores surface differs from the plan this record assumes, reconcile and
  note the delta in the effort README — don't build against the plan.

## Verify

- `yarn ci` green; converted suites keep their assertions.
- The documented examples run verbatim: (a) `Link` navigation against a test router with no
  mocks; (b) a component reading two stores rendered with a two-store partial container,
  no casts, typecheck clean.
- Dispose pin: unmounting the harness detaches the history (no listener growth across two
  sequential harnesses — the RF-01 pin pattern).
