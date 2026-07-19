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

## Per-item conventions

Atomic commits on the current branch; subjects prefixed `DX-NN:`, a `Closes: DX-NN` trailer
on the finishing commit. `yarn ci` green before handing over. The entry is public surface:
each item documents what it ships in `docs/current/public/reference.md` (a `rati/testing`
section) in the same item; internals notes where the promoted cores leave the fuzz harness.
Jnana-side commits (DX-06) follow Jnana's conventions; this record tracks only findings and
the rati-side fixes they force. Findings out of an item's scope get a dated note appended
here.
