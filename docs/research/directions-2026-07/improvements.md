# Future improvements & extensions — options per area

Options, not commitments. Items already designed elsewhere are cross-referenced, not
re-argued. Ordering within an area is roughly by how concrete the Jnana-side need is.

## 1. Scope & resolution

### Already sketched (cross-references)

- **`.live({…})` progressive prop** — hand the component a `Source<T>` instead of the
  unwrapped `T`, bypassing pending aggregation for that key
  ([deferred-scope-features.md](../deferred-scope-features.md)).
- **`.extend(baseScope)` — shared heads** — compose scopes over a common prefix
  ([deferred-scope-features.md](../deferred-scope-features.md)). Jnana's space-resolution
  prefix (`stores` → `spaceId`) recurs in `pageScope`, `softDeleteScope`,
  `blockHistoryScope`; this is the most likely of the deferred trio to become real.
- **`derive()` — cross-layer dependency escape hatch** inside a `.load()` level
  ([dependency-graphs.md](../dependency-graphs.md)).
- **Bare-hook dev guard** — detect a hook call inside a cached data load
  ([deferred-scope-features.md](../deferred-scope-features.md)).

### Abort signals for data loads (new)

A param change or teardown discards a level's in-flight promise loads, but the underlying
`fetch` keeps running. Passing an `AbortSignal` as a second argument lets a load opt in to
real cancellation; rati aborts it when the tree remounts (param change / retry) or unmounts:

```ts
scope({ spaceId: prop<Uuid>() })
    .load({
        members: ({ spaceId }, { signal }) =>
            apiClient.spaces[':spaceId'].members.$get({ param: { spaceId } }, { signal }),
    });
```

Cheap to add (the resolver already owns the remount boundary — one `AbortController` per
bucket), backwards compatible (loads that ignore the second argument behave as today).
Sources don't need it: `detach()` is already their cancellation.

### Scope refresh from below (new)

Today only the **error slot** gets `retry`. Mutations that invalidate route-scope data have
no sanctioned way to re-resolve it — Jnana's stores call `await this.load()` on themselves,
which works only because the data lives in a store, not in the scope. An imperative refresh
handle, readable inside the island's subtree, closes that gap:

```ts
const { refresh } = useScopeControls(pageScope);   // or: off useRouteContext(name)
…
await deleteMember(id);
refresh();                                          // bump the retry/params version → re-resolve
```

The mechanism exists (the mandala's retry counter); this only exposes it. Combined with
stale-keeping (§2) a refresh re-renders over the previous content instead of flashing the
loading slot. Design questions: does `refresh()` re-run *everything* or only promise loads
(sources are live and refresh themselves); and should it return the completion promise.

## 2. Islands / mandala — advanced loading states

The `remoteData` features worth keeping that are **presentation** concerns — pending
indication delay and stale-data display — belong in the mandala, not the data layer (the
data layer reports honest phases; the island decides what the user sees — see
[data-package.md](./data-package.md) for the split).

### Delayed loading slot (`indicatePendingAfterTimeoutMs` rehomed)

Fast resolutions shouldn't flash a spinner. An island-level option delays the loading slot;
until the delay elapses the island renders nothing (first load) or the previous content
(re-resolve, below):

```ts
island({
    scope: usersScope,
    component: UsersTable,
    loading: Spinner,
    loadingDelayMs: 200,      // slot appears only if resolution takes longer
});
```

Per-island rather than per-load: the aggregate phase is what the user sees. A route island
would take the same option in `RouteOptions`. (Name discussion in
[naming.md](./naming.md) — `indicatePendingAfterTimeoutMs` should not survive the move.)

### Stale content on re-resolve

On a param change or `refresh()` the island today tears down and re-renders the loading
slot. Often the better UX is keeping the previous content visible, marked stale, until the
new resolution is ready — the islands analogue of stale-while-revalidate. Two options:

- **Option A — island option + status hook (recommended).** `keepStale: true` keeps the
  last-ready props rendered during re-resolution; the subtree reads the phase to dim/badge:

  ```ts
  island({ scope, component: UsersTable, loading: Spinner, keepStale: true });

  function UsersTable(props: ScopeProps<typeof usersScope>) {
      const { isStale } = useIslandStatus();   // { phase, isStale, refresh? }
      return <Table data={props.users} className={isStale ? 'opacity-60' : ''} />;
  }
  ```

  Fits the existing engine: the mandala already holds the committed bucket; keeping the
  previous resolved props during a `treeKey` remount is a controlled extension of that.

- **Option B — React transitions.** Wrap the param-change re-render in
  `startTransition` and let Suspense keep showing old content, reading staleness from
  `useDeferredValue` comparisons. Less code owned by rati, but the behavior becomes
  React-scheduling-dependent and harder to make deterministic per island (and source-backed
  pending doesn't suspend, so it wouldn't be covered uniformly).

Note the interplay: `loadingDelayMs` handles "don't flash on fast loads"; `keepStale`
handles "don't blank on re-loads". They compose — with both set the loading slot appears
only for a slow **first** load.

### Retry policy (brief)

`error` slots get manual `retry` today. An optional per-island automatic policy —
`retry: { count: 2, backoffMs: 500 }` for `error.code === 'failed'` only (never
`not-available`) — would remove boilerplate retry buttons for transient network failures.
Wait for a real need; noted because the retry counter already exists.

## 3. Router

### Already sketched (cross-reference)

[router-extensions.md](../router-extensions.md) covers: nested wrapper stacks, layout-level
scope, `include()` route fragments, namespaced names, **typed path converters** (the
strongest fit — validates and coerces `:pageId` to its branded type at match time), route
guards, and regex paths. Of these, guards and converters are the two with visible Jnana
pull today (the auth/admin wrappers re-implement guarding ad hoc; `prop<Base64Uuid>()`
params arrive unvalidated).

### Typed search params (new)

Path params are typed end-to-end; the query string is stringly (`setSearchParams({ q })`).
A per-route search schema would give `?q=&page=` the same treatment as `:pageId`:

```ts
route('/admin/jobs', 'admin-jobs', AdminJobsPage, {
    search: { name: str.optional(), limit: int.default(100) },   // converter vocabulary
});

const [{ name, limit }, setSearch] = useSearchParams('admin-jobs');  // typed both ways
<Link to={{ name: 'admin-jobs', search: { limit: 500 } }} />          // typed in links too
```

Reuses the converter vocabulary from typed path converters (parse + format round-trip), so
the two features should be designed together. Open questions: whether unknown params pass
through untouched (they should), and whether a search change re-resolves the route's scope
(probably not by default — search is view state; an opt-in `resolveOnSearch` could cover
scopes that read it).

### Navigation status & blocking (brief)

- **Pending navigation indicator**: with route scopes resolving on navigation, a global
  `useNavigationStatus()` (`idle | resolving`) enables a top progress bar without app
  bookkeeping. Needs the router to know when the destination island reached ready — a small
  mandala→router signal.
- **Navigation blocking** (`useBlocker` / `beforeLeave`): "unsaved changes" guarding.
  Jnana's CRDT editor mostly saves continuously, so no pull yet; noted for form-heavy apps.
- **View Transitions API**: a `viewTransition` option on `navigate` wrapping the route swap
  in `document.startViewTransition`. One-liner-sized, cosmetic, wait for need.

## 4. Stores & DI

See [stores-and-router.md](./stores-and-router.md) — the container pattern assessment, the
router cycle, and the recommended restructuring (router constructed outside the container,
store-facing surface typed off `RatiUserTypes`).

## 5. Data layer

See [data-package.md](./data-package.md) — the companion package (`query` / `mutation` /
`collection` / pagination) replacing `data/` and Jnana's `FetchStore`.

One rati-core item belongs here: **`ResourceContainer` may migrate into rati** (from
`jnana/frontend/src/common/resources/`). It is framework-shaped already — generic,
domain-free ref-counting with `Disposable` integration, and rati's island teardown already
feature-detects `[Symbol.dispose]` on provided values. If it moves, it lands in core (it has
no MobX dependency) next to `Source`; `ResourcePool`'s `source()` adapter shows the two
compose. That would also give `.extend()`/layout-scope work a sanctioned sharing layer
(dedup by ref-count under shared heads instead of scope-level caching).

## 6. SSR → SSG & RSC (direction note only)

Noted as direction, deliberately not designed — Jnana needs neither (it is fully
interactive and doesn't even need SSR); these ride on the `examples/ssr` gallery until a
real consumer exists.

- **SSG** is the near step and is mostly a build script over existing pieces:
  enumerate static routes (paths without params, plus enumerated param values), run
  `prepareRoute` + `prerender` per URL, emit HTML + the two hydration payloads. Framework
  work is small: a route-table walker (`staticPaths` per param route) and a stable,
  versioned dehydration format. The existing consequence "server data must be an async
  load; sources stay pending under SSR" carries over unchanged.
- **RSC** maps naturally in principle — a scope's promise-load waterfall is exactly what a
  server component resolves, and the `hook()`/source loads are exactly what stays client —
  but adopting it means a bundler/runtime contract far beyond rati's current size. Treat it
  as a compatibility constraint, not a feature: keep scope modules importable in
  server-only contexts (no DOM at module scope), keep promise-load results serializable,
  keep the load/hook split crisp. Those habits cost nothing now and keep the door open.

## 7. DX & tooling (brief)

- **Test utilities** (`rati/testing` or exported from the package root): a controllable
  source (`controlledSource<T>()` with `.setReady(v)` / `.setError(e)` / `.reset()`), an
  island render harness (`renderIsland(island, { props })` wiring providers), and a
  memory-router harness (`createTestRouter(routes, { url })`). Jnana's tests and rati's own
  `__tests__` both hand-roll these today; this is the highest-value DX item.
- **Resolution tracing**: a `dataTrace` sibling to `navTrace` — per-island logs of level
  starts/settles with timings, making waterfalls visible. Cheap; helps tuning level
  placement (the "where a prop is declared" performance knob).
- **DevTools naming**: islands already carry `displayName`; extending it to Step components
  (`Step(users,tree)`) makes the React DevTools tree self-describing. Trivial.
