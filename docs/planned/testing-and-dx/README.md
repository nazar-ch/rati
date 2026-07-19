# testing-and-dx — the `rati/testing` entry, grounded in what both repos hand-roll

Status: planned 2026-07-19. Per-item status derives from rati git (`git log --grep 'DX-'`,
`Closes:` trailers) — never from this file; conventions below.

Executes [dx-and-tooling.md](../../research/dx-and-tooling.md), checked against what rati's
own suites and Jnana's frontend tests actually hand-roll (survey below) and built as
**public API** — the utilities ship for consumers, not just for rati's test tree. The
research doc's three bullets survive contact with the survey intact, and gain one member it
missed (the SSR round-trip kit).

## The 2026-07-19 survey — what is hand-rolled today

Verified at cut against both repos:

- **`deferred<T>()`** — six near-identical copies in rati
  (`mandala/island.test.tsx`, `scopeControls`, `suspenseEdges`, `data/mutation`,
  `data/query`, `router/routerIsland`) plus inline reinventions in four more files; four
  more independent reimplementations in Jnana (`FetchStore.test.ts`, `BootStore.test.ts`,
  `SyncDiagnosticsStore.test.ts`, `SpaceSyncStore.reseed.test.ts`).
- **A controllable source** — hand-rolled ~8× in rati's mandala suites (`testSource` /
  `makeSource` / `loaderSource`, several carrying the same "mirrors what an adapter does"
  comment); the most complete implementation is locked inside the fuzz harness
  (`__tests__/fuzz/scopeHarness.tsx`, `controllableSource`).
- **Router + provider wiring** — `createMemoryHistory` + `new RouterStore` + provider
  repeated inline across ~20 rati router test files, with `renderWithRouter` /
  `renderApp` / `renderLinkAt` local variants; the fuzz `routerHarness.tsx` holds the full
  version. Jnana never wires a real router — five files stub the surface with a hand-rolled
  `{ navigate: vi.fn(), … }` object, and two `vi.mock('rati')` to neuter `Link` because
  "rati `<Link>`s require a real RouterStore".
- **Stores injection** — ten Jnana component-test files build a structural fake container
  and inject it via `GenericStoresContext.Provider` with an `as unknown as GlobalStores`
  cast. The stores-container effort **internalizes** that context, so the pattern loses its
  seam — the testing entry must ship the sanctioned replacement.
- **SSR round-trip** — a `prerenderToString` drain loop + `hydrateRoot` +
  collector/provider wiring hand-rolled across rati's `islandSsr*`, `router/hydration`, and
  `ssr/*` suites (~20 files touch the pattern).
- **`flush()`/act-microtask helpers** — two identical named copies plus a raw
  `await act(async () => {})` idiom used 100+ times.

Bottom line: rati already contains production-quality versions of every proposed utility,
locked inside the fuzz harnesses. The effort is mostly *promotion* — extracting those cores
to a public entry, then deleting the duplicates behind them.

## Decisions taken 2026-07-19 (at cut)

- **The entry is `rati/testing`** (not root exports): test-only code stays out of the main
  surface; the entry follows the existing exports-map pattern (`rati-dev` / `types` /
  `import` / `source` conditions, like `./ssr` and `./data`).
- **The SSR round-trip kit is in v1** — the survey found it as duplicated as the rest, and
  public SSR consumers have no way to test hydration without hand-rolling the drain loop.
- **The Jnana adoption leg is the effort's success test** (DATA-03's pattern): if the ten
  fake-container files, five fake-router files, and two `Link` mocks don't get *shorter and
  honester*, the utilities are wrong.
- **`dataTrace` + `Step` displayName ride along** as one small observability item — same
  research doc, no reason for a second effort.
- **Cut assuming the stores-container work has landed** (`StoresProvider`,
  `createStoresHook`, table-blind router surface, `GenericStoresContext` internal). DX-03
  reconciles against what actually shipped.

## Items

DX-01 is the calibration gate: it creates the entry and sets the API style (naming, options
shape, docs placement) with the three smallest utilities. DX-02/03/04 promote the three
harnesses as parallel lanes — they share only the entry barrel, which each extends
additively. DX-05 dogfoods everything in rati's own suites (the duplicates die); DX-06 runs
the Jnana migration and files friction back as findings. DX-07 is independent and can run
whenever.

- [DX-01 — the `rati/testing` entry: `deferred`, `flush`, `controllableSource`](./issues/DX-01-testing-entry-foundation.md)
- [DX-02 — `renderIsland` harness + slot readers](./issues/DX-02-island-harness.md)
- [DX-03 — `createTestRouter` + the stores-injection seam](./issues/DX-03-router-and-stores-harness.md)
- [DX-04 — SSR round-trip kit](./issues/DX-04-ssr-roundtrip-kit.md)
- [DX-05 — dogfood: rati's suites adopt the entry](./issues/DX-05-dogfood-migration.md)
- [DX-06 — Jnana adoption leg (the success test)](./issues/DX-06-jnana-adoption.md)
- [DX-07 — `dataTrace` + `Step` displayName](./issues/DX-07-observability.md)

Batching, dependencies, grading: [plan.md](./plan.md).

## Findings

(Appended as dated notes as items execute. DX-06's friction findings are the effort's main
output besides the code — anywhere the utilities force a workaround is the signal a future
item needs.)

### 2026-07-19 — DX-01 (entry + API style pinned)

The B1 style decisions, for every later item to copy:

- **Entry** `src/testing/`, one file per primitive + an additive barrel; wired into the
  exports map and the lib build like `./ssr`. Byte-identical builds for every pre-existing
  entry (the entry is side-effect-free and unreferenced from `main.ts`).
- **`controllableSource` mutators are raw** (no auto-`act`). A source is driven both from
  the test top level *and* from inside engine flow (a `queueMicrotask` in a load, a fuzz
  command already inside `act`); an auto-`act` breaks the latter. The test wraps a top-level
  drive (`act(async () => src.setReady(v))`) or follows it with `await flush()`.
- **Naming reconciliation** (research doc said `setReady`/`setError`/`reset`): `reset` was
  too weak — the copies pend/re-ready repeatedly and one needs identity-stable recovery. Final
  surface: `setReady` / `setPending` / `setError` (a bare string → the `code`) / `emit()`
  (re-emit the last value, stable identity — the S8/pin-12 recovery case). Ledger:
  `attachCount` / `detachCount` / `attached` / `peakAttached`. Options: `initial`, `ssr`
  (marker passthrough), `loads` (the `ssr: true` loader shape), `onAttach` / `onDetach`.
- **`@testing-library/react` is not a dependency** — decided absent. `flush` imports `act`
  from `react`; the render harness (DX-02) uses `react-dom/client`.
- **Docs** live in `reference.md` under a `## rati/testing` section (last entry, test-only).

### 2026-07-19 — DX-02 (renderIsland) friction, for DX-05 to expect

- **The async mount can't pin StrictMode's discard-remount.** `renderIsland` mounts under an
  async `act` so a pending promise/source settles; React skips StrictMode's
  mount/unmount/remount double-invoke under an async act (verified: a single `attach`, no
  remount). A plain sync `act(() => root.render())` triggers the remount but then can't settle
  a *later*-resolved promise (the un-awaited sync act with pending Suspense leaves the boundary
  stuck). No single mount does both — the original suite already used async-wrapped mounts for
  async tests and plain sync `render` for the StrictMode cases. So `island.test.tsx`'s three
  StrictMode-remount tests **stay on a bare RTL `render`** (driving the promoted
  `controllableSource` factory); everything else moved to `renderIsland`.
- **`renderIsland` is single-island.** Two mounts in `island.test.tsx` aren't (a bare reader
  with no island above; two sibling islands sharing a scope) — they stay on RTL. `renderIsland`
  covers one island + its slots/controls; a bare-component or multi-island render is out of
  scope by design. DX-05 should not force those onto it.
- **Slot detection via private markers, not testids.** Config mode wraps each slot in a
  `data-rati-testing-slot` element (visibility-aware, for the Suspense-hidden-stale case) — so
  `slot()`/`text()` work without any testid entering the island's own API. A pre-built island
  exposes neither scope nor slots, so `slot()`/`text()`/`controls()` need the config form.
- Converted with assertions preserved: `island.test.tsx` (23 tests) and `suspenseEdges.test.tsx`
  (4) — the latter's `ledger(log,id)` became the source's own `attachCount`/`peakAttached`.
- **Follow-up (SI-03 not landed):** `ScopeControls` is still `{ refresh, pending }` — no
  `phase`/`isStale`. So `handle.controls()` surfaces exactly those two; when SI-03 lands and
  widens `ScopeControls`, the handle gets `phase`/`isStale` for free (it returns the whole
  `useScopeControls` value), no harness change needed.

### 2026-07-19 — DX-03 (router + stores seams), reconcile + frictions

- **The stores-container work this record's cut assumed did NOT land.** The plan named
  `StoresProvider` / `createStoresHook` and a now-internal `GenericStoresContext`. What
  actually shipped (`packages/rati/src/stores/RootStore.tsx`): `RootStore` (a class wrapping
  `stores` + `isReady`/`init`), `RootStoreProvider`, `createUseStoresHook`, and a still-**public**
  `GenericStoresContext`. So the "the context is internalized, the seam is lost" premise is
  moot — the Jnana pattern still compiles. Per the boundary rule, `renderWithStores` is built
  as a new designed surface on `RootStore` + `RootStoreProvider` (a partial container marked
  ready), **not** a re-export of `GenericStoresContext`. The value it adds is the typed partial
  that kills the `as unknown as GlobalStores` cast, not access to the seam (which was never
  taken away). DX-06 (Jnana) migrates the ten fake-container files onto it.
- **`createTestRouter` uses memory history; `<Link>` relative-href tests can't move to it.**
  A `<Link href="..">` is resolved by the *DOM* against `window.location`, not the router's
  history — so `router/link.test.tsx` (the RF-07 relative-resolution pins: `..`, `sub`, `?q`,
  `#h`) is inherently a **browser**-history suite and stays on `window.history.replaceState` +
  a browser `RouterStore`. `createTestRouter` fits every test that drives *absolute* navigation
  (route matching, `navigate`, `back`/`forward`, `<Link href="/abs">`), which is the bulk. DX-05
  should leave the relative-`Link` suite on the browser history rather than force it.
- **Shared mount factored out.** `renderIsland` (DX-02), `createTestRouter`, and
  `renderWithStores` now share `src/testing/dom.tsx` (`mountTree` + the one `cleanup()` +
  a per-mount dispose hook — the router's `dispose` runs there). `renderIsland`'s public API
  is unchanged; `cleanup` moved to `./dom` and is re-exported.
- Converted with assertions preserved: `router/routerIsland.test.tsx` (8, its source hand-roll
  now a `controllableSource`) and `router/routerSuspense.test.tsx` (3). Both dropped the local
  `renderWithRouter` helper, `window.history.replaceState`, and the manual `router.dispose()`.
  New example tests (Link-no-mocks, two-store partial container, the RF-01 dispose pin) in
  `__tests__/testing/routerAndStores.test.tsx`.

### 2026-07-19 — DX-04 (SSR round-trip kit) shipped + decisions

- **Surface** (`src/testing/ssr.tsx`, additive on the barrel): `prerenderToString(node,
  options?)` (the bare drain loop), `ssrRender(node, options?)` → a `ServerRender` handle
  (`html` / `data` / `seeds` / `errors` / `hydrate()`), and `ServerRender.hydrate(clientNode?,
  options?)` → a `HydratedTree` (`container` / `text()` / `recovered` / `rerender` /
  `unmount`). Options: `prerenderToString`/`ssrRender` take `onError` + `progressiveChunkSize`;
  `.hydrate()` takes `allowMismatch` + `onDispose`.
- **Two-phase, not one-shot.** The kit splits at the server/client seam (`ssrRender` returns,
  then `.hydrate()`), because the suites split there too — a third of the SSR tests are
  *server-only* (assert the HTML + the dehydrated `data`/`seeds`/`errors`, never hydrate). One
  merged `ssrRoundTrip()` would have forced those to hydrate pointlessly. `prerenderToString`
  stays separate below both, for the no-collector pins (a marked source staying pending with
  no `HydrationProvider` — which `ssrRender` always adds — is a real behavior a test asserts).
- **Mismatch → failure via `onRecoverableError`, not console.** `.hydrate()` collects React's
  recoverable hydration errors and throws by default, naming the mismatch. That is the channel
  the suites already established as the real signal (a re-run load re-suspends its loading slot
  over the server's content → React client-renders → `onRecoverableError`); console.error
  can't see it (its default is `reportGlobalError`). `allowMismatch: true` collects on
  `.recovered` instead — the deliberate-degradation pins (SSR-error baseline, a seed whose
  `hydrate` throws).
- **`prerenderToString` is its own thin loop, not a re-export of `rati/ssr`'s `renderToHtml`.**
  Same shape (`prerender` + no-outlining budget), but coupling the testing kit to the
  production renderer is exactly the "freeze an internal" risk the grading flagged — a change
  to `renderToHtml`'s option surface would ripple into every test. The duplication the effort
  kills is the ~20 *in-suite* copies (DX-05), not the one prod renderer.
- **Route-level = documented composition, no helper** (item 3's "helper only if composition is
  ugly", weighed against the grading's don't-freeze-internals). The kit owns
  prerender→collect→hydrate; the router-SSR wiring (two routers, `prepareRoute`, memory vs
  browser history) stays the caller's, handed to `ssrRender`/`.hydrate` as two trees.
  `createTestRouter` (DX-03) can't be reused for it — that mounts with `createRoot`, and SSR
  needs `hydrateRoot` over server HTML — so the composition shares *building blocks*
  (`RouterStore`/`RootStore`/`prepareRoute`), not the function. Reference docs carry the full
  snippet; a converted suite proves it.
- **Shared mount extended, not forked.** `.hydrate()` runs through a fourth `testing/dom.tsx`
  primitive, `hydrateTree` (pre-fill container → `hydrateRoot` under async act → track for
  `cleanup()`), alongside `mountTree`. So `afterEach(cleanup)` tears round-trips down too, and
  the client router's `dispose` rides the same per-mount `onDispose` hook the test router uses.
- **The "one `ssr/` suite" reconciliation.** Converted `islandSsr.test.tsx` (5, the island
  round-trip — `prerenderToString` + `ssrRender` + `.hydrate()`, all three flavors) and
  `router/hydration.test.tsx` (3, the route-level composition, proving item 3). The literal
  `ssr/` *directory* holds no round-trip suite to convert: `payload` is serialization (no
  prerender→hydrate), and `renderApp`/`wholeDocument` are HTTP-/whole-document-level — the
  boundaries explicitly exclude those. `router/hydration` is the faithful stand-in, and the one
  the item's own §Problem names. New example tests in `__tests__/testing/ssr.test.tsx` (the
  worked docs example verbatim + a `controllableSource`-loader round-trip + the negative
  mismatch pin, both throw and opt-out).
- **Friction for DX-05:** the `islandSsr*Sources`/`ssrErrors` suites hand-roll
  `loaderSource`/`liveSource`/`failingLoaderSource` (marked sources with attach/detach logs);
  several map onto `controllableSource({ ssr, loads, onAttach, onDetach })`, but the
  live-seed + failing-seed shapes carry per-instance seed logic the current
  `controllableSource` doesn't model. DX-05 should convert what maps cleanly and leave the
  seed-shape sources hand-rolled (or file a `controllableSource` seed-hook gap), not force it.

## Per-item conventions

Atomic commits on the current branch; subjects prefixed `DX-NN:`, a `Closes: DX-NN` trailer
on the finishing commit. `yarn ci` green before handing over. The entry is public surface:
each item documents what it ships in `docs/current/public/reference.md` (a `rati/testing`
section) in the same item; internals notes where the promoted cores leave the fuzz harness.
Jnana-side commits (DX-06) follow Jnana's conventions; this record tracks only findings and
the rati-side fixes they force. Findings out of an item's scope get a dated note appended
here.
