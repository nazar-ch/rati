# rati — internals

Implementation notes for contributors. For the public API see
[design-and-usage.md](./design-and-usage.md); for future-facing explorations see
[research/](./research/).

## Source layout

```
src/
  mandala/   the core renderable unit (the shared engine under island & route)
    mandala.tsx     createMandala() + MandalaConfig / MandalaComponent
    resolver.tsx    the scope → Step-tree waterfall (Step, Leaf, ProvideLeaf, buildTree)
    channel.ts      the value channel + useScope / useOptionalScope / useScopeRead
    boundary.tsx    the error boundary
    hydration.tsx   SSR promise dehydration
  island/    island.ts — public island() wrapper + Island* / IslandHydration* aliases
  router/    route.tsx (route() + route/param types), store.ts (WebRouterStore),
             Router, Link, Navigate, useRouteContext, prepareRoute, history,
             scrollRestoration, lazy
  scope/     scope.ts (scope/prop/load/provide/hook + scope types), source.ts
  data/      remoteData, apiUtils, ActiveData (REST/data helpers)
  stores/    RootStore, GlobalStore (store roots)
  util/      utils.ts
  types/     generic.ts
  main.ts    the public barrel
```

## The mandala — one engine, two faces

`island()` (standalone) and `route()` (URL-bound) both build the **same** thing: a scope
bound to a component with loading/error slots, that resolves its own data, provides a value
to its subtree, and owns the data lifecycle. That shared abstraction is the **mandala**
(`mandala/mandala.tsx`) — named for the concentric Step-tree resolving inward to the center
(the component).

> **Internal name only.** Public API and DevTools say `island` / `route`, never "mandala".
> `createMandala(config, kindLabel)` takes the public label (`'Island'` / `'Route'`) for the
> React `displayName` and the scope's read-error identifier. `island = createMandala(…,
> 'Island')`; `route` folds its `{ scope, component, loading, error }` into
> `createMandala(…, 'Route')` and attaches the routing bits (path, name, wrapper, the runtime
> `scope` field). So there is no "route island" — a route *is* a mandala.

## The resolver — a per-level Step tree

`mandala/resolver.tsx` compiles a scope into a nested tree of `Step` components — one per
`.load()` level — and lets React be the resolver (`buildTree` → `Step` → … → `Leaf`).

- **Waterfall = nesting.** Each `Step` resolves its level and renders the next once ready;
  the `Leaf` provides the value and renders the component.
- **Hooks/data split, per level.** `hook()` loads run **every render** in a stable loop
  (fixed key set → stable hook order, so the loop is rules-of-hooks-safe); everything else is
  a **data load** built once and cached. The Step runs all hook loads first, then resolves
  the data cells (`use(promise)`, source snapshot reads), so an early "pending" return is
  hook-order safe.
- **Loading = Suspense + slot.** A pending *promise* suspends (the `<Suspense>` fallback is
  the loading slot); a pending *source* sets a pending flag → the loading slot.
- **Errors = the boundary.** A rejected promise (`use()`) or a thrown source error reaches
  `MandalaErrorBoundary` → the `error` slot (switch on `error.code`), or rethrows to the
  nearest outer boundary when there's no slot.
- **Live values = `useSyncExternalStore`.** Each Step subscribes to its level's sources
  through one `useSyncExternalStore`; a ready `Source<T>` whose value updates flows to the
  component reactively — only a *phase* change swaps slots. (Hook sources own their own
  subscription.)

### The bucket cache lives on the mandala's committed ref

A level's data cells (and its source list) are built once into a `Bucket` held on the
mandala component's `useRef` — **not** on the Step's fiber. A Step that `use()`s a pending
promise suspends, and React discards the suspended render's fiber; a Step-local cell would be
rebuilt on the retry, re-run its load, and re-suspend on a brand-new promise forever. Holding
the bucket on the committed mandala ref makes the load run once. The bucket array is rebuilt
only when the inner tree remounts (`treeKey` = params version + retry counter).

### Lifecycle & teardown ordering (structural)

The dispose-before-detach ordering that used to be hand-coded now falls out of React's
effect phases:

- A `Step` attaches its level's **data** sources in a **passive** effect, detaches on unmount.
- The `.provide()` value (at the `Leaf`, the innermost level) is built and disposed
  (`[Symbol.dispose]`) in a **layout** effect.
- On unmount React flushes **all layout cleanups before any passive cleanup**, and unmounts
  **children before parents** → the leaf's provided value disposes *before* the sources it was
  built over detach. A store built over a grabbed resource is torn down while that grab is
  still live.

A param change (by value) bumps `treeKey`, remounting the inner tree under a `<Fragment
key>`: React tears the old run down (children-first) and resolves the new params from scratch;
same-params source transitions re-render in place, keeping promise/source identity.

## The value channel (`mandala/channel.ts`)

What an island provides is published through a React context **keyed by the scope's
identity**, not the component's:

- `registerScopeChannel(scope)` get-or-creates one `Context` per scope object (mandalas built
  from the same scope share it). The `Leaf` renders `<channel.Provider value={provided}>`.
- `useScope(scope)` / `useOptionalScope(scope)` look the channel up by the scope and read it.
  A descendant imports the **scope** (a cycle-free data module), never the component that
  renders it — so there is no child→parent reference or import cycle (the component renders
  the descendant). Nearest provider wins.
- `useScopeRead(scope)` is the shared primitive: it returns a discriminated
  `{ status: 'value' | 'no-provider' | 'no-island' }` so each caller crafts its own
  identifier-bearing error. `no-provider` = a mandala for the scope exists but none is above
  this component; `no-island` = no mandala uses this scope (a misuse). `useScope` throws on
  both; `useOptionalScope` returns `undefined` on `no-provider` and throws on `no-island`;
  `useRouteContext` reuses it with route-name messages. A per-scope label (the mandala's
  `displayName`) and the scope's load keys identify the scope in the message.

## Sources (`scope/source.ts`)

A `Source<T>` is a reactive `pending | ready | error` machine: `subscribe`/`getSnapshot` are
`useSyncExternalStore`-shaped (the Step reads them through uSES, so transitions re-render;
`getSnapshot` must return a stable reference while unchanged) and `attach()` starts/holds the
underlying work and returns a detach function. The unified `SourceError` collapses
not-available / forbidden / failed into one shape with a machine-readable `code`. CRDT
resources, REST loaders and promises all implement the interface, so the resolver is
source-agnostic. `readySource` / `promiseSource` / `toSource` are the adapters; `toSourceError`
normalizes thrown reasons.

## SSR dehydration (`mandala/hydration.tsx`)

Promise loads resolved on the server are carried to the client through a small,
framework-owned registry, keyed `mandalaId (useId) → scopeKey → value`:

- **Server.** Under `react-dom/static` `prerender`, each `Step` that unwraps a promise with
  `use()` calls `collect(...)`. `useId()` is stable by tree position across server/client.
- **Client.** `IslandHydrationProvider data={…}` feeds the registry back; on first mount a
  Step short-circuits a dehydrated key to a value cell — skipping the load (no re-fetch) and
  `use()` (no re-suspend) — so hydration renders the server HTML synchronously.
- Only *promises* are serialized; *sources* stay pending under SSR and resolve on the client.
  The mechanism is router-orthogonal (a route is just a mandala), so route SSR and standalone
  island SSR participate the same way. Public exports are the `IslandHydration*` aliases in
  `island/island.ts`.

The routing snapshot is separate: `prepareRoute(router)` (`router/prepareRoute.ts`) drives a
memory-history router to its matched route and returns `WebRouterHydratedState`; the client
seeds it via `WebRouterStoreOptions.hydratedState`.

## Router (`router/`)

`WebRouterStore` (`store.ts`) owns history, the active route, basename
handling, and navigation (`navigate`/`replace`/`setSearchParams`/`preloadRoute`). It is a
plain external store — a listener `Set` plus `subscribe`/`getSnapshot` (a version counter);
`useWebRouter` reads it through `useSyncExternalStore`, so every consumer re-renders on a
change. `route()`
(`route.tsx`) is a thin wrapper over `createMandala` plus the route/param **types**:

- `ExtractRouteParams<Path>` turns `:param` segments into a typed param record.
- `NameToRoute<Routes>` is the union of `{ name } & params` for every route — the type of
  `Link`'s `to` and `navigate`'s argument.
- **Route context typing** reads the route's real runtime `scope` field: `RouteContextValueOf`
  maps a route name → `ScopeProvidesOf<itsScope>`; `RouteContextNames` is the set of
  scope-bearing names. Both come from `RatiUserTypes['routes']` (the app's `as const` table),
  the same augmentation `Link` reads — so `useRouteContext('page')` is typed with no
  registration.

## Invariants

- A scope's per-level key set is **static per mandala instance** (required for the hook
  loop's positional matching). Scopes are fixed defs, so this holds.
- A load that calls a React hook **must** be wrapped in `hook()`. A bare function load is
  cached data — its hook would run once and break.
- `useScope` keys on **scope object identity**; reusing one scope across two mandalas
  collapses them onto one channel (nearest wins). Give distinct scopes when two same-scope
  islands must be read independently from overlapping subtrees.

## Toolchain

rati runs on **Vite+** (`vp` — bundles Vite/Rolldown, Vitest, oxlint, oxfmt). Lint/format
config lives in the root `vite.config.ts` `lint`/`fmt` blocks (no eslint/prettier); Node is
pinned to 26 via `devEngines.runtime`.

Types: **tsgo** (`@typescript/native-preview`, the TS 7 native compiler) — there is no
`typescript` dep. `vp run typecheck` type-checks (`tsconfig.json` for src,
`tsconfig.test.json` for the test tree), `vp run build` emits `.d.ts` via
`tsgo -p tsconfig.build.json`, and Vitest's `--typecheck` pass over `*.test-d.ts` uses tsgo
through `test.typecheck.checker`. The core is decorator-free; the MobX-coupled data layer
under `rati/mobx` (`data/`) still uses decorators (`@observable`/`@action`), which compile via
`@babel/plugin-proposal-decorators` — oxc can't lower native decorators yet — see
`vite.config.ts`/`vitest.config.ts`.

Lint deviates from a stock config for a generics-heavy framework: the type-machinery rules
(`no-explicit-any`, `no-non-null-assertion`, `no-empty-object-type`,
`no-redundant-type-constituents`) are `warn`, and `no-unnecessary-type-assertion` is `off`
because tsgolint's necessity analysis disagrees with tsgo (it ignores
`noUncheckedIndexedAccess` and strips load-bearing generic casts). tsgo is the authoritative
type gate. Commands: `vp build` / `vp test` / `vp run typecheck` / `vp lint` / `vp fmt` /
`vp check`. Releasing: [RELEASING.md](./RELEASING.md).
