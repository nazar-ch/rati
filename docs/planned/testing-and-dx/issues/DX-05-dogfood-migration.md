# DX-05 — dogfood: rati's suites adopt the entry

area: packages/rati/src/__tests__/ (broad), src/testing/ (fixes it forces)
needs: DX-02, DX-03, DX-04 merged
disposition: cut 2026-07-19; the survey's duplication counts are the work list

## Problem

The utilities exist (B2) but the duplicates still stand: ~6 `deferred` copies, ~8
controllable sources, ~20 inline router wirings, 2 `flush` copies, the SSR drain loops.
Until rati's own suites run on the public entry, the entry is unproven at breadth — and the
duplicates keep teaching new tests the old way.

## Scope

1. **The sweep**, suite by suite: replace local `deferred`/`testSource`/`makeSource`/
   `loaderSource`/`renderWithRouter`/`renderApp`/`renderLinkAt`/`flush`/drain-loops with the
   `rati/testing` equivalents; delete the local definitions. The survey's file list is the
   starting inventory; re-grep at execution (`deferred<`, `testSource`, `makeSource`,
   `createMemoryHistory` in tests, `prerender(` in tests) — the tree has moved since the cut.
2. **Hard rule: no lost pins.** Assertion counts and what each test observes stay
   equivalent — a migration that weakens an assertion or drops a kill-tested pin is a
   defect, not a simplification. Where a local helper does something the public one
   deliberately doesn't (fuzz-specific ledgers, model wiring), it stays local — file the
   judgment call as a README note rather than forcing the fit.
3. **API friction found here fixes the entry in the same item** (small, decision-free) or
   files a finding (anything with a design smell) — the same fix-or-file line the review
   efforts use.
4. **The fuzz harnesses** import the shared cores where DX-01/02/03 left seams for it;
   their fuzz-facing behavior must not move (seeds, budgets, assertions unchanged).

## Boundaries

- rati only; Jnana is DX-06.
- No test-behavior changes beyond helper sourcing; no reorganizing suites, no renames of
  test files.
- `src/data/` tests may adopt `deferred` (it is generic) but nothing island/router-shaped —
  the data layer's testing story is its own effort's business.

## Reconcile — 2026-07-19 pre-review (see the README's pre-DX-05 note)

The coverage inventory re-ran ahead of execution; deltas against the survey this item was
cut from:

- **API gaps are closed up front**: `controllableSource` gained `seed` (the
  `islandSsrSources` liveSource shapes now map — including the throwing-hydrate pin) and
  `createTestRouter` gained `basename`/`hydratedState` (unblocks `preloadRoute`'s
  Link-prefetch block and `redirect`'s hydration-replay pin). No mid-sweep API work should
  be needed; anything else found is fix-or-file per item 3.
- **The router population is three groups, not one**: 14 store-level suites never mount
  (2-line constructor wiring — stay local, no README-note needed beyond one line for the
  group); migratable: `preloadRoute` (prefetch block), `redirect`; stays-by-design:
  `link` (relative-href RF-07 pins, browser history), `navigateComponent` (StrictMode +
  browser history is the pin), `lazy` (no router wiring), `ssrRender.test` (the deliberate
  `renderToString` contrast keeps its local drain; its `prerenderToString` still swaps).
- **Suggested batch order** (each its own commit): (1) mechanical import swaps —
  `data/mutation` deferred, fuzz `commands`/`routerCommands` flush, `router/ssrRender`
  prerenderToString, bare `await act(async () => {})` → `flush()`; (2) simple source swaps —
  `orphanedBucketLeak`, `strictModeLifecycle` (RTL mount stays: StrictMode), `head`;
  (3) `islandSsrSources` + `islandSsrErrors` onto `seed`/`ssrRender` (the seed option's
  acceptance test); (4) `scopeControls.test.tsx` alone — largest file, 4 local helpers die,
  ~63 act call sites re-audited under the no-lost-pins rule (its `probeControls` stays: the
  suite mounts bare RTL trees, not islands); (5) router batch + README notes for survivors;
  (6) fuzz core swaps last, `FUZZ_SEED=1` spot checks. The `routerHarness` delegation to
  `createTestRouter` is *possible* now but perturbs the mount choreography the properties
  were tuned on (sync buildHarness inside command-level acts vs the async act-mount) —
  keep-local is the sanctioned default; note the decision either way.

## Verify

- `yarn ci` green, including the deep fuzz budget with pinned-seed spot checks
  (`FUZZ_SEED=1` on the two command suites) — the fuzz lanes must be bit-for-bit
  indifferent to the migration.
- Grep gate: no `function deferred` / hand-rolled `[SourceSymbol]` test source / local
  `flush` definitions left under `__tests__/` outside the fuzz harness internals; each
  survivor justified by a line in the README note.
- Test count identical before/after (paste both counts in the finishing commit message).
