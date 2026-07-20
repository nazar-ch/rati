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
- [DX-08 — SSR error-channel hardening: per-collector rejection dedup + a prerender settle budget](./issues/DX-08-ssr-error-channel.md)
- [DX-09 — a real RouterStore fits a `PartialStores` slot](./issues/DX-09-router-in-partial-stores.md)
  (cut 2026-07-20 from the DX-06 frictions)

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

### 2026-07-19 — pre-DX-05 review of B1+B2 (three-lens audit; hardening landed)

DX-01..04 were audited before opening the dogfood/adoption legs: an adversarial review of
the utilities against the real engine contracts, a DX-05 coverage inventory over rati's
suites, and a DX-06 fit check against Jnana's actual test files. The engine contracts all
held (source contract incl. uSES snapshot stability and mid-notify unsubscribe; the controls
channel does wrap every slot, so the Probe never misses; `ssrRender(...).hydrate()` twice is
safe — the collector is read-only on hydration and claims are per-provider; the
`display:none` slot walk matches React 19's `hideInstance`, marker-self and ancestor both;
`createTestRouter`'s replace-before-listen state seeding and sync memory-history emits are
real). What didn't hold was fixed in the same pass:

- **Act-flag policy** — the entry no longer sets `IS_REACT_ACT_ENVIRONMENT` permanently
  ("defensively") on first mount; every helper now scopes set→restore around its own `act`
  (`testing/actEnvironment.ts`, the RTL pattern). Trigger: Jnana's `unitSetup.ts` documents
  a deliberate decision *not* to set the global (Tiptap portal re-renders would warn), and
  the permanent set would have overridden that from inside a library. rati's own suites now
  declare the env runner-level (`vitest.setup.ts`).
- **`renderIsland` input holes** — `props` (and `rerender`'s argument) are now conditionally
  *required* when the scope has required inputs; before, `handle.rerender()` type-checked
  and silently remounted with `{}`, wiping every input. `slot()` now throws when no marker
  is in the DOM at all (an island that unmounted or threw past its slots used to read as
  `'loading'`).
- **`controllableSource.seed`** — the DX-04-flagged gap, closed ahead of DX-05:
  `{ dehydrate?, hydrate }` where `hydrate` *returns* the seeded value (throw = a store
  rejecting a stale seed); combines with `loads` for "load on attach unless seeded";
  mutually exclusive with raw `ssr`. Kills the self-referential `ssr.hydrate` closure (and
  its forced type annotation) that `islandSsrSources`' three `liveSource` shapes would have
  needed. Also: `initial`/`loads` now use `in`-checks, so `T = undefined` works.
- **`createTestRouter`** gained `basename` + `hydratedState` passthrough — without
  `basename` the fuzz `routerHarness` could never delegate, and `redirect.test.tsx`'s
  hydration-replay pin needs `hydratedState`.
- **Stores seam, recalibrated for Jnana** — `stores` options are now `PartialStores<S>`
  (each store itself a typed partial: the flat slice a component reads type-checks with no
  cast), and `storesWrapper(stores?)` ships the provider *without* the mount, so RTL /
  `vitest-browser-react` files keep their renderer (8 of Jnana's 10 fake-container files
  want exactly that; the two `.browser` files have no other clean migration).
  `renderWithStores` is now sugar over it.
- Small: `hydrateTree` tracks (or removes) its container when hydration throws mid-act;
  `prerenderToString` flushes its TextDecoder after the drain.

Intel the reviews produced for the open items (the full agent reports are conversation
artifacts; the durable deltas live in the amended issue files):

- **DX-05**: the "~20 inline router wirings" split into three populations — 14 store-level
  suites that never mount (their wiring is a 2-line constructor; they stay), a small
  mounting-migratable set (`preloadRoute`'s Link-prefetch block, `redirect`), and
  stays-by-design files (`link` relative-href pins, `navigateComponent`'s
  StrictMode+browser-history pin, `ssrRender.test`'s deliberate `renderToString` contrast).
  `scopeControls.test.tsx` is the largest single job (4 local helpers die, ~63 act call
  sites re-audited). Fuzz seams: `flush` and `controllableSource` swaps are behavior-neutral
  (the public ledger is a 1:1 rename of `SourceLedger`; `emit()`'s throw-before-ready is
  unreachable under valid command sequences); the `routerHarness` delegation is *possible*
  after `basename` but perturbs the mount choreography the properties were tuned on —
  keep-local is the honest default, README-noted. Suggested batch order is in DX-05.
- **DX-06**: the ten stores files are functionally covered, but 8 of 10 should adopt
  `storesWrapper` + their existing renderer, not `renderWithStores`; the grep gate's
  "no `as unknown as GlobalStores`" is achievable, but *nested* fakes (a `user` model on a
  store) still need a per-field cast — the container-level cast is what dies by design.
  `fakeRouter` (boot harness) was mis-scoped to `createTestRouter` (it's a store-level fake
  consumed by `bootHarness.ts`, which Boundaries exclude) — the issue file is amended.
  Real-route legs should use minimal local route tables (importing `frontend/src/routes.ts`
  drags ~40 page modules into unit tests). Five non-render files fake the container as a
  *constructor argument* — out of any render-utility's reach, documented as survivors.
- **Engine finding, filed as DX-08**: the resolver's `recordedRejections` WeakSet is
  module-global, so a *second* `ssrRender` of a tree reusing the same rejected promise
  instance silently skips `collectError` — its `errors` come back empty. Per-collector
  keying is the fix; a settle-budget option for `prerenderToString` rides along.

### 2026-07-19 — DX-05 (the dogfood sweep landed)

rati's own suites run on `rati/testing`; the duplicate helpers behind it are deleted. Test
count identical before and after — **62 files / 555 tests / 0 type errors** both sides — and
the deep fuzz lanes are bit-for-bit indifferent (`FUZZ_SEED=1` on both command properties
unchanged; the mandala suites also pass a 300-run pinned-seed deepening). Six atomic commits,
the survey's batch order: mechanical import swaps → simple source swaps → the islandSsr
sources/errors acceptance test → scopeControls → the router migratables → the fuzz core.

**Judgment calls (helpers kept as thin adapters over the entry, §Scope item 2).** Three
suites keep small local *factories* that build a `controllableSource` and layer a
test-specific concern the public ledger deliberately doesn't model — an **ordered string log
across lifecycle events**, wired through `onAttach`/`onDetach` (and, for the seed shapes, the
`hydrate` callback):

- `islandSsrSources` — `loaderSource` / `liveSource` / `failingLoaderSource`. The pins read
  `['attach', 'detach']` and `['hydrate:1', 'attach']` — an ordering *between* attach and a
  seed's hydrate that `attachCount`/`peakAttached` can't express. The state machine is the
  entry's; only the log wiring is local.
- `scopeControls` — `testSource(log, id)`. The cascade-swap pins read `attach:s1` / `detach:s1`
  / `attach:s2`, a per-*id* log the numeric ledger isn't keyed by. Its `.ready`/`.fail`
  (which wrapped a sync `act`) became `act(() => src.setReady/setError)` at the call sites.
- The fuzz `scopeHarness` core (`makeControllable`) `Object.assign`s the model driver
  (`ready` = recompute-then-`setReady`, `restore` = `emit`, `pend`/`fail`) onto the entry's
  `controllableSource`; `ledger()` reads the per-instance bounds off each source's own
  `attachCount`/`detachCount`/`peakAttached`/`attached` (the 1:1 `SourceLedger` rename).

**Survivors (kept on their existing scaffolding, one line each per §Verify).**

- `strictModeLifecycle` — the RTL `render(<StrictMode>…)` stays: `renderIsland`'s async-act
  mount skips the discard-remount the test exists to pin (the DX-02 friction note). Source
  swapped to `controllableSource`; `probeControls` stays (no island `controls()` under RTL).
- `scopeControls` — RTL `render` + `probeControls` + Pin 5's manual collector/`hydrateRoot`
  stay: the suite reads `pending` at precise quiesce points and drives refreshes over a
  hydrated tree, choreography the harness's own mount/`.hydrate()` would perturb (and Pin 5
  on `.hydrate()` would force a dual-renderer `cleanup`). Only its four helpers moved.
- `orphanedBucketLeak`, `head` — RTL `render` stays (bare-island DOM/`screen` assertions);
  only the hand-rolled sources (and `head`'s `prerenderToString` drain) moved.
- Router **store-level suites** (never mount — a 2-line `new RouterStore` + `router.dispose()`):
  the `RouterStore.preloadRoute` block, `redirect`'s twelve navigation/`prepareRoute` tests,
  and the `webRouter*` / `prepareRoute` / `hydration` files. Constructor wiring, no harness fit.
- `router/link` (relative-href RF-07 pins resolve against `window.location`, a browser-history
  suite), `router/navigateComponent` (StrictMode + browser history), `router/lazy` (no router
  wiring), `router/ssrRender` (its `renderToString` contrast keeps a local drain; its
  `prerenderToString` swapped in the batch-1 sweep) — all stay, per the pre-DX-05 intel.
- The fuzz `routerHarness` delegation to `createTestRouter` is **not** taken: it would perturb
  the sync-`buildHarness`-inside-command-`act` choreography the properties were tuned on
  (keep-local is the sanctioned default). Its `flush` one-liner did move (batch 1).
- `flushScrollRestoration` (`router/scrollRestoration`, `router/webRouterHashAnchor`) is a
  scroll-rAF drain, not the act-microtask `flush` — unrelated to the entry, untouched.

### 2026-07-19 — DX-07 (observability) shipped + decisions

Two commits, both independent of the entry work: the `Step` naming, then `dataTrace`.

- **`dataTrace` is per island *run*, not one global timeline.** navTrace's model (a single
  timeline reset at the click) doesn't transfer: islands resolve concurrently, so the
  meaningful clock is the generation's own. Each run carries a `DataTrace` (undefined when
  off) alongside its bucket cache, created where the generation is — so the cause
  (`initial` / `inputs` / `retry`) falls straight out of `treeKey` and no bookkeeping is
  needed to know when a run ended. The format keeps navTrace's two numbers, re-based: `+`
  since the run started, `Δ` since the cell's own mark. The island label leads the line
  (navTrace's numbers lead) because the log is multi-source — the label is what you scan by.
- **Transitions, not reads.** A source's snapshot is read every render and a hook load's
  value is produced every render; logging those would drown the log. The trace holds a
  per-cell last-status and logs only on a change, which is also what makes a live source's
  drop back to `pending` visible. Consequence worth knowing: a source that keeps producing
  *new values* while staying `ready` logs nothing — a value-level trace is a different tool
  (and belongs to `rati/data`, out of scope here).
- **Promise settles are timed by their own handlers**, attached where the load ran (cell
  build / refresh re-run / hook classification), not at `use()`'s return — `use()` returns
  when React resumes, which is later and lumps the scheduling delay into the load. Guarded
  by a module WeakSet, the same guard (and reason) as the SSR rejection recording.
- **Inputs get no settle line and level 0 keeps its index.** Level 0 is the scope's inputs
  head — it opens the run (carrying the cause) but its cells aren't loads. Renumbering the
  `.load()` levels to start at 0 was rejected: the resolver, `navTrace`'s source-attach
  marks, and internals all number levels with the head as 0.
- **The `Step` name is a bound copy, not a wrapper.** A wrapper component would add a fiber
  per level to every app forever, for a debug affordance; `Step.bind(null)` memoized on the
  frozen level object gives DevTools a name with no tree change and a stable per-level
  identity (a fresh type per render would remount the level and detach its sources — pinned
  in `mandala/stepNaming.test.tsx`). The island's label is the parent in the tree, so the
  Step name doesn't repeat it — and *can't*, since a level object is shared by every mandala
  built from the same scope.
- **Both features are pinned by tests that read what the tools produce**: the console lines
  with durations normalized (`__tests__/debug/dataTrace.test.tsx`), and the live fiber tree
  walked the way DevTools names it (`type.displayName || type.name`). The demo was driven
  in a browser for the manual check the item asks for: `Route(ComplexTestWithScope) →
  Step(productName) → Step(name) → Step(first) → Step(xStore) → Leaf`, and that route's
  four-level waterfall traced end to end.

### 2026-07-19 — DX-08 (SSR error channel) shipped + decisions

Three commits: the rejection ledger, the data trace's twin of it, the settle budget.
`yarn ci` green; 64 files / 569 tests.

- **Per *run*, not per collector.** The item suggested `WeakMap<collector, WeakSet<promise>>`;
  what shipped is a WeakSet created with the generation's bucket cache (beside its data
  trace) and handed to the resolver on `Shared`. Three reasons the collector is the wrong
  key: the `collectError` the resolver sees is a mandala-bound closure rebuilt every render,
  so it can't key anything; the *underlying* collector would dedup across islands, but
  `errors` entries are `{ mandalaId, key, error }` — two islands sharing one rejected promise
  are two honest records, not a duplicate; and a run renders under exactly one collector, so
  run-keying strictly implies collector-keying while staying finer. Per-*cell* was rejected
  for the opposite failure: a hook load handing back a stable promise builds a fresh cell
  object every render, so a cell-level flag would stack handlers all over again.
- **Nothing was "retained for the no-collector path"** (the item's parenthetical): the whole
  recording block is gated on `collectError`, so there is no client-side recording to keep a
  global for. The module-level WeakSet is simply gone.
- **The same hole existed in `dataTrace`**, whose comment already paired itself with this
  guard — fixed in the same effort rather than left to contradict its own cross-reference.
  Worth knowing for its pin: within a run the *visible* log is deduped by `traceCellStatus`'s
  status map, so the module-global guard cost only the **second run's** settle line (a cell
  that reads as stuck at pending in the log while the island rendered fine). Removing the
  guard outright therefore breaks nothing visible — the pin is two mounts over one promise.
- **`settleTimeout` runs over `prerender`'s own `signal`, not a `Promise.race`.** Pinned by
  experiment: aborting a prerender *resolves* it (never rejects), closes the stream, and
  calls `onError` once per still-pending task with the abort reason **and that task's
  `componentStack`**. So the abort is the release valve *and* the census — the message names
  the budget, the boundary count, and where they were. A race would have left the render
  running and reported nothing but the elapsed milliseconds. `postponed !== null` (React's
  own "did not complete" flag) gates the throw, so a budget expiring during the drain of an
  already-finished render can't fail a good test.
- **Off by default**, per the item's escape hatch, and the reasoning is the recommendation:
  any value rati picked sits either above the host runner's own timeout (never fires) or
  below a legitimately slow load (false failure), and a fake-timers suite would make it
  fire on `advanceTimersByTime`. Discoverability is the docs' job — reference.md carries a
  "when a server render hangs" paragraph under the kit.
- **The component stack names `Step`, not `Step(live)`.** React's server-side stack frames
  come from the function's own name and source position, so DX-07's per-level `displayName`
  doesn't reach them; the *count* of `Step` frames still gives the level depth, and the
  frames around it place the island. Good enough for the item's "or at least the elapsed
  budget and the likely cause" floor, and better than it.

### 2026-07-20 — DX-06 (the Jnana adoption leg landed)

Ran against **published `rati@0.6.1`** — the entry ships in the release Jnana already
depends on, so no `rati-dev` alias and no local rati source in the loop. Jnana PR:
[nazar-ch/jnana#825](https://github.com/nazar-ch/jnana/pull/825), four commits (one per leg,
plus the docs). Both Jnana gates green after each leg and unchanged in size: `frontend-unit`
132 files / **1213 → 1214** tests (the one new test is below), `frontend-browser` 27 files /
**247** tests. The §Verify grep gate is clean — no `as unknown as GlobalStores`, no
`vi.mock('rati'`, and no `GenericStoresContext` at all in `frontend/test/`.

**By the numbers, over the ten files: 986 → 970 lines (−16).** The concepts the survey named:
`GenericStoresContext` mentions 32 → **0**; the container cast `as unknown as GlobalStores`
10 → **0**; `vi.mock('rati', …)` 2 → **0**; all `as unknown as` 30 → **16**; `vi.fn()`
15 → **9** (what's left is authClient spies and one router partial).

**The line count is the honest disappointment: flat.** Per leg — stores 609 → 607, router
230 → **213**, Link 147 → 150. The stores leg is where the utilities were supposed to pay and
it broke even, because `storesWrapper<S>({…})` + `render(ui, { wrapper })` costs about what
the provider JSX cost, while each file *gained* a `SessionContainer` type import and a line of
comment explaining the surviving nested cast (~7 lines of that across the six). Strip those and
the mechanical delta is ≈ −9. Lines only really fall where a *fake* died rather than moved:
the two guard files lost 17 by replacing spy bookkeeping with `router.path` reads. The Link leg
grew by 3 because it gained a test.

So: **honester, unambiguously; shorter, only where a hand-rolled surface disappeared.** Which
is the right read of the disposition, not a failure of the utilities — the ten files' problem
was never length, it was that they asserted against an imitation.

**Per-file judgment calls** (§Scope asks for the record):

- `storesWrapper` + the file's existing renderer, no cast: `connectivityDot.browser`,
  `anonymousShell.browser` (the two `.browser` files, as the item requires),
  `twoFactorSettingsPage`, `spaceNodeCreateGating`, `DocRejectedDot`, `UpgradeGate`.
- `createTestRouter` with a minimal local table (3–4 routes): `authLayout` (5 tests),
  `guards` (8), `loginPage` (3), `twoFactorPage` (6). All four *care* about routing —
  redirect targets or a `<Link>`. Local tables, per the pre-DX-05 intel: importing Jnana's
  `routes.tsx` drags ~40 page + scope modules into a unit test.
- **`renderWithStores` had no taker.** Every one of the ten files already had a renderer
  worth keeping (RTL, or `vitest-browser-react`), so the DX-03 recalibration that split
  `storesWrapper` out of it is what made the leg possible — 6 of 6, not 8 of 10.
- `test/boot/fakes.ts`'s `fakeRouter` untouched, per this record's own 2026-07-19 correction.

**The one friction that wants a rati-side answer: a real `RouterStore` cannot go in a
`PartialStores` slot.** Jnana types its container's `router` as `RouterStore<typeof routes>`
(the app's exact 32-route tuple), so `Partial<RouterStore<typeof routes>>` demands `routes`
be that tuple, and a store built over a *local* table is rejected:

```
Type 'RouterStore<{…'/home/'…}[]>' is not assignable to type 'Partial<RouterStore<readonly [
  {…'/'…}, … 30 more …, {…}]>>'. Types of property 'routes' are incompatible.
  Target requires 32 element(s) but source may have fewer.
```

This inverts the item's expectation. A `{ navigate: vi.fn(), path, search, searchParams }`
fake needs **no** cast (none of those fields is route-table-typed) — it is the *honest* value
that can't be expressed. So "give the file a real test router" is reachable only through
`createTestRouter`, which sidesteps the check by building the container itself
(`{ ...options.stores, router } as S`). Fine wherever routing matters; the gap is the file
that needs a router-shaped presence under a renderer it must keep —
`anonymousShell.browser`, which therefore keeps its typed partial as a **survivor**. Shape of
a fix, if it's worth one: let the `router` slot accept a `RouterStore<any>` (or exclude
`routes` from the partial), so a bare `new RouterStore({}, localTable, { history })` can be
injected without a cast.

**Second friction, consumer-side, no rati change:** a `rati/*` entry that's new to a
Vitest **browser** project must be added to `optimizeDeps.include`. The first two-file run
after the migration failed three tests inside React's `useState` — the un-prebundled entry
triggered a mid-run re-optimization, which reads as a component crash, not a bundling event.
Worth a line in the entry's docs for consumers with browser-mode suites.

**Survivors, one line each (§Verify).**

- Five non-render files fake a container as a **constructor argument** (`workspaceStores`,
  `UIStore.hostStatus`, `UIStore.syncPaused`, `resolveReadonlyReason`, `readonlyWorkspace`) —
  untouched, out of any render utility's reach, exactly as pre-justified.
- One in-file ctor cast survives in `UpgradeGate` (`new UIStore(… as GlobalStoresContainer)`).
- **Per-field casts on nested models** — `authStore.user` (5 files), `authStore.workspaceStores`
  (2). `PartialStores` is one level deep by design; this is the predicted, correct cost, and
  Jnana's new docs section says so explicitly so nobody reads them as unfinished work.
- `anonymousShell.browser`'s router partial — the friction above.

**What the utilities got right, unprompted:** `storesWrapper`'s partial-of-partials caught two
mistyped slices during the migration that the old `as unknown as` container would have carried
to a runtime failure; `createTestRouter`'s memory history made the open-redirect pin
(`//evil.example` as a `returnTo`) an actual "the router did not move" assertion; and the
act-flag scoping held — Jnana's `unitSetup.ts` still sets no global
`IS_REACT_ACT_ENVIRONMENT` and not one migrated file warned.

**Jnana-side extras**, for the record: `.claude/frontend-testing.md` gained the section the
survey found missing (the ten-file pattern was entirely undocumented), and Jnana's commit
subjects read `rati DX-06:` — a bare `DX-06:` collides with Jnana's own `DX` prefix
(its external-interactions effort), which its issue-tracking gate flagged.

## Per-item conventions

Atomic commits on the current branch; subjects prefixed `DX-NN:`, a `Closes: DX-NN` trailer
on the finishing commit. `yarn ci` green before handing over. The entry is public surface:
each item documents what it ships in `docs/current/public/reference.md` (a `rati/testing`
section) in the same item; internals notes where the promoted cores leave the fuzz harness.
Jnana-side commits (DX-06) follow Jnana's conventions; this record tracks only findings and
the rati-side fixes they force. Findings out of an item's scope get a dated note appended
here.
