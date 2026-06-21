# Data views & islands — architecture draft

Status: **draft / experiment** (June 2026). The "Experimental implementation" section describes
code that exists in `packages/rati/src/experimental/`; everything else is design space.
Naming is intentionally provisional — see [Discussion](#discussion).

## Philosophy

- Components never manage loading states or duplicate types. They receive **clean, fully
  loaded, typed props** and render.
- The data side is **declarative**: a view describes *which data go where* — prop names bound
  to params, promises, functions, and stores. It is not a loader; loaders are machinery the
  declaration gets wired to.
- Types flow end to end: a view function calls a typed API client / store, and the component
  prop types are inferred from it. Zero manually written prop types.
- Waterfalls are first-class and visible. `chain` levels resolve sequentially (each level sees
  the resolved props of the levels before it); props within a level resolve in parallel.
  Dependencies are expressed by *where* a prop is declared, not by effect ordering.

```ts
const pageView = createView
    .chain({ spaceId: viewParam<Uuid>(), pageId: viewParam<Uuid>() }) // inputs
    .chain({ tree: ({ spaceId }) => loadTree(spaceId) })              // level 1
    .chain({ page: ({ spaceId, pageId }) => loadPage(spaceId, pageId) }); // level 2, after tree
```

## Vocabulary (provisional)

| Term | Meaning |
| --- | --- |
| **view** (data definition) | The declarative chain built with `createView` / `.chain()`. Tells which data get where. |
| **island** | A self-contained UI unit: a view bundled with a component and loading/failure slots. Mountable anywhere — routes, panels, embedded fragments. |
| **params** | Plain, serializable inputs declared with `viewParam<T>()` (ids from the URL, props from the host). Diffed by value to decide re-resolution. |
| **env** | Per-root services view functions need (stores, API clients). Injected, never part of params. |
| **resolved props** | The output record handed to the component: every chain key, resolved. |

## Case study: what islands must replace

`jnana .../pages/components/Page.tsx` is the reference case. Its ~85 lines spend effort on:

1. **Typed failure states** — manual `loading / not-available / error / ready` switches in JSX.
2. **Resource lifecycle** — grab from a ref-counted cache (`ResourceContainer`) on mount,
   release on unmount.
3. **Identity** — `key={pageId}` remount-on-param-change.
4. **Context** — `PageContextProvider` hand-delivering the loaded store to descendants.

Notably, the space tree and the page doc load **in parallel** there today, while the intended
semantics are "make sure the space is loaded → load the page". The chain makes the waterfall
real — and once `tree` resolves before `page`, it can finally be passed into the page context.

## The island unit

An island owns everything around loading so the component doesn't have to:

```tsx
export const Page = createIsland({
    useEnv: () => {
        const { resourcesStore } = useUserStores();
        return { resourcesStore };
    },
    view: (env) => pageView(env),
    component: PageBody,           // gets clean resolved props
    loading: PageSkeleton,         // gets { params }
    notAvailable: PageNotFound,    // gets { params, error: NotAvailableError, retry }
    error: PageError,              // gets { params, error, retry }
});

// <Page spaceId={...} pageId={...} /> — props are exactly the view's params
```

The wrapper owns:

- **Param diffing** — re-resolve when params change by value (`deepEqual`); params are plain
  data, so value comparison is safe and cheap.
- **Env diffing** — `useEnv` usually builds a fresh object from stable services every render
  (`() => ({ resourcesStore })`), so env is compared **shallowly**. A changed service identity
  re-resolves; a fresh wrapper object does not. (Identity comparison here is an infinite
  re-resolve loop — found the hard way in tests.)
- **Race control** — a superseded in-flight resolve never renders; its results are disposed
  when they land.
- **Disposal** — see the lifecycle contract below.
- **Failure routing** — typed errors to slots; with no `error` slot the error is rethrown
  during render for the nearest `ErrorBoundary`.

### Options not in the experiment (yet)

- **Remount identity.** The experiment re-resolves in place and shows `loading` on param
  change. Alternatives: auto-`key` the component by params (state resets like jnana's
  `key={pageId}`), or `keepPrevious: true` (stale content while the next resolve runs,
  optionally with an `isStale` flag — leans back toward the loading-state styles we're
  avoiding, so it should stay an explicit opt-in).
- **Suspense variant.** When `loading` is omitted, suspend instead (React 19 `use()`), letting
  a parent `<Suspense>` own the fallback and enabling transitions/streaming SSR. Slots and
  Suspense can coexist; slots are the explicit default.
- **Progressive/partial props.** Render with some props while slow ones stream in. Conflicts
  with "components never see loading states" — if ever added, as a per-prop opt-in that wraps
  only the marked prop in a state object, never the default.

## Environment injection

View functions need stores, but module-level views can't close over per-root instances
(breaks SSR multi-request isolation; breaks multiple roots). Options:

**A. Env factory (implemented).** The view is a function of env; the island builds env via a
hook and calls the factory on each resolve:

```ts
const pageView = (env: PageEnv) =>
    createView
        .chain({ spaceId: viewParam<Uuid>(), pageId: viewParam<Uuid>() })
        .chain({ tree: ({ spaceId }) => env.spaces.loadTree(spaceId) });
```

No type machinery changes; env is typed by the factory parameter. Cost: views are factories,
not values, so two islands can't share one view *instance* (they share the factory).

**B. Env as a second argument, in the types.** `CreateView<VD, Env>`; functions become
`(params, env) => ...`; the island infers `Env` from the view and demands a matching `useEnv`:

```ts
const pageView = createView
    .env<PageEnv>()
    .chain({ spaceId: viewParam<Uuid>() })
    .chain({ tree: ({ spaceId }, env) => env.spaces.loadTree(spaceId) });
```

Views stay values; resolution gets an explicit env argument (also the natural place for an
`AbortSignal`: `(params, { env, signal })`). Cost: one more type parameter threaded through
`CreateView`/`ChainableView`/`ResolveView` and the contextual-inference paths that were just
simplified. Worth doing once the env shape stabilizes; the factory pattern migrates to it
mechanically.

**C. Stores as params.** Rejected: pollutes `RequiredViewParams`, makes param diffing hit
store objects, breaks the "params are serializable data" property that SSR and routing rely on.

## Failure semantics

Implemented contract: **typed exceptions**.

- `NotAvailableError` — the data does not exist (404-like). Routed to the `notAvailable` slot
  (falls back to `error`). Carries an optional `code` and `cause`.
- Anything else — routed to the `error` slot; rethrown into the render when no slot is given,
  so `ErrorBoundary` is the default error UI.
- Both slots receive `retry()`.

Alternative considered: Result-style returns (`{ ok } | { notAvailable } | { error }`) that the
wrapper unwraps. Keeps view functions exception-free, but adds unwrapping noise to every
definition for a distinction (absence vs failure) that genuinely is exceptional control flow.
Exceptions also compose through helper functions for free.

## Lifecycle & disposal contract

The keystone rule: **the island owns what the view resolves**.

- Any resolved prop that **responds to `[Symbol.dispose]` with a callable** is disposed when the
  island unmounts, when params/env change (before the next resolve starts), or when its resolve
  turns out to be superseded or failed. Disposability is detected by *reading* the disposer, not
  by probing `Symbol.dispose in prop` — a resource may synthesize its disposer on access (e.g. a
  ref-counted handle behind a `Proxy` whose dispose comes from the `get` trap, which an `in`
  probe wouldn't see). The standard `Disposable` get is the whole contract; resources need
  nothing rati-specific (no `has` trap to satisfy feature-detection).
- A failed waterfall disposes the levels that *did* resolve before the failure — a grabbed
  space tree is released when the page level throws.
- A superseded resolve runs to its next cancellation checkpoint (between levels and at the
  end), then disposes everything it accumulated. Cancellation cannot interrupt a level
  mid-flight — that is what `AbortSignal` support would add.

This dovetails with ref-counted caches: a view function that `grab`s from a
`ResourceContainer` returns a `GrabbedResource`, which already implements `Symbol.dispose` →
release is automatic, per island instance. Two panels showing the same page each grab and each
release; the container's ref-counting does the rest.

Open: `Symbol.asyncDispose` (async teardown), and whether dispose-on-param-change should
overlap with the next resolve (`keepPrevious`) instead of preceding it.

## The loader stack

Views consume anything awaitable, so loaders standardize *caching and lifecycle*, not access:

**Tier 1 — keyed immutable data (to build).** The legacy-REST workhorse: dedupe concurrent
calls by key, share results across islands, plain frozen data, no MobX. Sketch:

```ts
const spaceMeta = keyedData((spaceId: Uuid) => api.spaces.meta({ spaceId }), {
    ttlMs: 60_000,
});

// in a view: { meta: ({ spaceId }) => spaceMeta(spaceId) }
// spaceMeta.invalidate(spaceId) → next resolve refetches
```

~50 lines: a `Map<key, Promise<T>>`, failed promises evicted, optional TTL, `invalidate`.

**Tier 2 — `remoteData` (exists).** A stateful single function: debounce, race guard, pending
indication. Fits form-driven and search-style fetching. Could grow a keyed variant.

**Tier 3 — ref-counted live resources (exists in jnana, candidate to lift into rati).**
`ResourceContainer` + `ResourceLoader`: dedup loading by id, publish ready stores, ref-counted
grab/release with `Symbol.dispose`. Generic and battle-tested; lifting it makes the island
disposal contract first-class across projects. `ActiveData` stays the mutable-draft layer on
top of loaded data.

## Router integration (implemented)

The key fact: **an island is already a routable component.** `createIsland` returns a plain
`FC<RequiredViewParams<View>>`, and the router's no-view rendering branch passes
`routeParams` as props — which are exactly the island's params. Nothing in
`WebRouterStore` / `Router` / `prepareRoute` / hydration changes; islands ride the existing
machinery, and `route()` keeps working as-is.

`route2` is an additive alternative shape (working name) that moves view/wrapper into options
and produces the *same route record* as `route`:

```ts
const routes = [
    // island route: path params feed the island, typechecked against the view's params
    route2('/spaces/:spaceId/pages/:pageId', 'page', PageIsland),

    // classic view route, now via options (ViewLoader + SSR path, unchanged behavior)
    route2('/about', 'about', AboutComponent, { view: aboutView, wrapper: PageFrame }),

    route2('*', 'notFound', NotFound),
] as const;
```

Differences to be aware of on island routes:

- The island, not the router, owns loading/error UI — the route-level `Loading` only shows
  for lazy chunk imports.
- `prepareRoute` (SSR) resolves only `options.view`; islands resolve client-side for now
  (see limitations). A server path for islands is future work.
- Route params are strings; an island used on a route should declare its params as
  `viewParam<string>()` (or a string-compatible branded type).

## View-based context (implemented as island-keyed, opt-in)

Resolved props provided to the subtree, keyed by the island:

```tsx
const Page = createIsland({ ..., provideContext: true });

// anywhere under Page's component, fully typed: ResolveView<View>
const { tree, pageDoc } = useIslandProps(Page);
```

- Opt-in via `provideContext: true`; without it `useIslandProps` throws a pointed error.
- Keyed by the **island component** (a `WeakMap` island → React context + a type-level brand
  on the returned FC), not by the view — views are env-factories in the experiment, so the
  island is the stable identity. Nearest provider wins: two panels with different pages stay
  scoped.
- Replaces hand-built providers like jnana's `PageContextProvider` — and because the chain
  resolves `tree` before `page`, the space tree can finally live in the page context.
- A view-keyed variant (`useViewProps(pageView)`) stays on the table for when views become
  stable values (env-in-types, option B above).

## More ideas

- **Shared chain prefixes.** Two islands needing the space tree declare it independently;
  dedup happens in the loader tier (keyed cache / ResourceLoader), not in the view layer.
  Composition (`spaceView` extended by `pageView = createView(spaceView, {...})`) expresses
  shared *shape*; caches dedupe the actual IO.
- **Prefetch.** `island.prefetch(params, env)` resolving into the caches ahead of
  navigation/hover; route-level integration with `prepareRoute` for SSR parity.
- **Invalidation subscriptions.** Track which cache keys a resolve touched (env wraps the
  cache with a tracker); `invalidate(key)` re-resolves subscribed islands. This is the
  react-query feature set rebuilt at the island level — components still see only clean props.
- **Devtools.** Optional level labels (`.chain('tree', {...})`) → waterfall timing logs,
  "what is this island waiting on".
- **SSR / streaming.** Islands resolve server-side and hydrate via pre-resolved props (the
  `initialViewProps` mechanism in `ViewLoader` already does this for routes). Tier-1 data is
  serializable; tier-3 live stores need a hydration story per store. Suspense streaming pairs
  with per-island resolution naturally.
- **Testing.** Views are values/factories: `resolveView(view(fakeEnv), params)` in a unit test,
  no rendering. Components take plain props. The island wrapper is the only piece needing DOM
  tests, and it's generic.

## Experimental implementation

In `packages/rati/src/experimental/island.tsx`, exported from `rati` main
(`createIsland`, `useIslandProps`, `NotAvailableError`, `disposeViewProps`, `IslandConfig`,
`IslandComponent`), plus `route2` / `RouteOptions` in `WebRouterStore`.
Existing `createView` / `resolveView` / `ViewLoader` / `route` are untouched and remain
functional — islands reuse the view chain machinery and add their own resolver.

Included:

- `createIsland(config)` → `IslandComponent<View>` (a plain `FC<RequiredViewParams<View>>`
  with a type-level brand; config per the sample above).
- Waterfall resolver with the lifecycle contract: cancellation checkpoints between levels,
  dispose-on-failure, dispose-on-supersede, dispose-on-unmount/param-change.
- Typed failure routing with `retry`; rethrow to `ErrorBoundary` when no `error` slot.
- Param diffing by `deepEqual`, env diffing by shallow equality.
- Island type helpers — `IslandProps<typeof viewFactory>` / `IslandParams<typeof viewFactory>`
  (and `IslandViewOf`), the factory-aware counterparts of `ResolveView` / `RequiredViewParams`.
  The island's view is an env→view factory, so the component and loading/failure slots can type
  themselves straight off it instead of deriving `ResolveView<ReturnType<typeof viewFactory>>`
  by hand.
- Opt-in auto-context: `provideContext: true` + `useIslandProps(Island)`.
- Router integration: islands as route components (existing `route` or `route2`); `route2`
  with `options: { view?, wrapper? }` producing the same record as `route`.

Limitations (deliberate, for now): no `AbortSignal`, no SSR path for islands, no
`keepPrevious`/auto-key options, sync `Symbol.dispose` only, `useEnv` is required, context is
island-keyed (not view-keyed).

## Migrating jnana's Page (sketch)

A jnana-side helper bridges loader states to the island contract once:

```ts
// jnana side — awaits readiness, converts states to typed errors, grabs ref-counted
async function loadAndGrab<T extends DisposableResource>(
    loaders: ResourceLoader<T, { spaceId: string }>,
    cache: ResourceContainer<T>,
    id: string,
    spaceId: string
): Promise<GrabbedResource<T>> {
    const loader = loaders.load(id, { spaceId });
    await when(() => loader.state.stateValue !== 'loading');
    const state = loader.state;
    if (state.stateValue === 'not-available') throw new NotAvailableError(`${id} not found`);
    if (state.stateValue === 'error') throw new Error(state.errorCode);
    return cache.grab('page-island', id)!; // GrabbedResource has Symbol.dispose → auto-release
}
```

The view encodes the intended waterfall (space first, then page):

```ts
type PageEnv = { resourcesStore: ResourcesStore };

const pageView = (env: PageEnv) =>
    createView
        .chain({ spaceId: viewParam<Base64Uuid>(), pageId: viewParam<Base64Uuid>() })
        .chain({
            tree: ({ spaceId }) =>
                loadAndGrab(env.resourcesStore.loadingTrees, env.resourcesStore.trees, spaceId, spaceId),
        })
        .chain({
            pageDoc: ({ spaceId, pageId }) =>
                loadAndGrab(env.resourcesStore.loadingPages, env.resourcesStore.pages, pageId, spaceId),
        });
```

The component becomes purely presentational + reactive concerns. Its props (and the slots'
`params`) come from the view factory via the island helpers — `IslandProps<typeof pageView>` /
`IslandParams<typeof pageView>` — so nothing is derived by hand:

```tsx
const PageBody = observer(({ spaceId, pageId, tree, pageDoc }: IslandProps<typeof pageView>) => {
    // Reactive concerns stay in the component: document title, URL sync autorun
    useDocumentTitle(tree.getPageTitle(pageId) || 'Untitled');
    usePanelUrlSync(spaceId, pageId, tree);

    return (
        <PageContextProvider pageDocStore={pageDoc} tree={tree} key={pageId}>
            <BlockList />
        </PageContextProvider>
    );
});

export const Page = createIsland({
    useEnv,
    view: pageView,
    component: PageBody,
    provideContext: true, // BlockList & co. can useIslandProps(Page) instead of PageContext
    ...
});

// mountable directly in a panel, or on a route:
// route2('/s/:spaceId/p/:pageId', 'page', Page)
```

What this buys over the current `Page.tsx`: the waterfall is explicit, `tree` is available to
the page context, all four manual concerns (states, grab/release, identity, context wiring)
collapse into the island, and the old `Page.tsx` keeps working untouched while this runs in
parallel.

## Discussion

**Naming (deferred, constraints gathered so far).**

- The declarative chain is *not* a "loader" — loaders are machinery; the chain declares which
  data get where.
- "View" arguably belongs to the *unit* (component + data + slots) rather than to the data
  definition alone — the upward lift. The experiment hints at this: `createIsland` is close to
  what "a view" conceptually is, while `createView` names only its data half.
- Spec-name candidates so far: `data` / `viewData`, `source`, `scope` (strongest if view-based
  context lands — the chain then literally defines a typed scope provided to a subtree).
- Unit-name candidates: `island`, or `view` itself after the lift.
- `route2` is likewise a working name; it can absorb `route` (or get a real name) once the
  options shape settles.

**Open questions.**

- Env: stay with factories (A) or move env into the types (B)? Leaning: A until the env shape
  stabilizes across 2–3 real islands, then B together with `AbortSignal` support.
- Default remount policy: re-resolve in place (current) vs auto-key by params. Leaning:
  in-place + documented external `key` for state resets.
- Where does `ResourceContainer`/`ResourceLoader` live — rati or app land? Leaning: lift into
  rati once the island contract proves out in jnana.
- Suspense: opt-in variant or eventual default? Leaning: opt-in until SSR streaming matters.
- `notAvailable` as a slot vs a convention over `error` (`error instanceof NotAvailableError`
  in one slot)? Currently a slot; it mirrors how distinctly products treat 404s.
- Disposal on param change happens *before* the next resolve starts (resources released during
  loading). With `keepPrevious` it would have to move after — interaction to design.
- `viewParam` keys double as island prop names and as `RequiredViewParams`; route params
  already flow this way. Should islands accept extra non-view props to pass through to slots?
