# rati — reference

The complete public API, by entry point. For the concepts and worked examples, start with
the [guide](./guide.md).

| Entry | Contents |
| --- | --- |
| `rati` | Everything client-side: scopes, islands, routing, sources, stores. |
| `rati/ssr` | The server-facing surface: hydration, `prepareRoute`. |
| `rati/mobx` | Optional MobX bindings (`observableSource`) and the legacy data layer. |
| `rati/debug` | Opt-in debug tooling (`navTrace`). |

> **Status:** first public iteration. The stores container surface (§Stores) is being
> finalized; names there may still move.

---

## Scopes

### `scope(inputs)`

Starts a scope from a head of named inputs. Returns a chainable scope value.

```ts
const s = scope({ stationId: input<string>(), limit: input<number>() });
```

### `input<T>()`

Declares one typed input in a scope head. Inputs arrive as the island's props (or a
route's path params) and are diffed by value — a changed input re-resolves the scope.

### `.load(level)`

Adds one resolution level. Keys within a level resolve in parallel; levels resolve in
sequence, and each level's functions receive everything resolved so far
(inputs + all previous levels) as their argument.

Accepted entry shapes:

| Entry | Behavior | Resolved prop |
| --- | --- | --- |
| plain value | passed through | the value |
| `(props) => T` / `(props) => Promise<T>` | called once per resolution, result cached per island instance | `T` (awaited) |
| `Promise<T>` | awaited | `T` |
| a class | constructed with the resolved props so far | the instance |
| `Source<T>` or `(props) => Source<T>` | attached on mount, detached on unmount/input change | `T` when ready |
| `hook(fn)` | `fn` runs every render, may call hooks | `fn`'s return; a returned `Source<T>` unwraps to `T` |

A plain function load must not call React hooks (it is cached and would run its hook
once) — use `hook()` for that.

### `.provide(factory, options?)`

Terminal. Replaces what the island provides to its subtree (by default: the resolved
props) with `factory(resolvedProps)`. The value is lifecycle-managed — if it implements
`[Symbol.dispose]`, it is disposed on island teardown, before the sources it was built
over detach. `options.provideTo: Context` additionally publishes the value into an
app-owned React context.

### `hook(fn)`

Marks a load as hook-based: `fn` runs on every render (never cached) and may call any
React hook. Use it for dependency injection (`hook(() => useStores())`) and for adapting
hook-based data libraries. `fn` receives the resolved props so far. A `hook()` load owns
its own subscription lifecycle; rati never attaches or detaches it.

### Scope types

```ts
type Props   = ScopeProps<typeof s>;      // resolved props (Source<T> unwraps to T)
type Inputs  = ScopeInputs<typeof s>;     // the input() head
type Value   = ScopeProvidesOf<typeof s>; // what useScope(s) returns
const C: ScopeComponent<typeof s> = …;    // component typed to the resolved props
```

Also exported: `Scope`, `ChainableScope`, `Input`, `HookLoad`, `ScopeProvideDef`, and the
symbols `InputSymbol` / `ScopeSymbol` / `ScopeDefinitionsSymbol` / `ScopeProvidesSymbol`
(advanced: identity checks and library-level introspection).

---

## Islands

### `island(config)`

Builds a component from a scope. The returned component's props are the scope's inputs.

```ts
island({
    scope,        // required: the Scope value
    component,    // required: ComponentType<ScopeProps<S>>
    loading,      // optional: ComponentType<{ inputs: ScopeInputs<S> }>
    error,        // optional: ComponentType<{ inputs: ScopeInputs<S>; error: SourceError; retry: () => void }>
});
```

- Without `loading`, the island renders nothing while resolving.
- Without `error`, a failure throws to the nearest ErrorBoundary.
- `retry` re-mounts the island's inner tree: fresh promises, fresh sources.
- Types: `IslandComponent<S>`, `IslandConfig<S>`.

### `useScope(scope)` / `useOptionalScope(scope)`

Read what the nearest island built from `scope` provides — the `.provide()` value, or the
resolved props. `useScope` throws outside such an island; `useOptionalScope` returns
`undefined`. Islands built from the same scope share one channel; a reader gets the
nearest one (React context semantics).

---

## Sources

A source is the live-data primitive: an external `pending → ready | error` state machine
that islands read through `useSyncExternalStore`.

```ts
interface Source<T> {
    readonly [SourceSymbol]: true;
    subscribe(onChange: () => void): () => void;
    getSnapshot(): SourceState<T>;    // must be reference-stable while unchanged
    attach(): () => void;             // start the work; returns a detach function
}

type SourceState<T> =
    | { status: 'pending' }
    | { status: 'ready'; value: T }
    | { status: 'error'; error: SourceError };
```

| Export | Purpose |
| --- | --- |
| `readySource(value)` | a source that is already ready |
| `promiseSource(promise)` | pending until the promise settles |
| `toSource(x)` | lift a value / promise / source (idempotent on sources) |
| `isSource(x)` | type guard |
| `toSourceError(reason)` | map a thrown value to a `SourceError` |
| `NotAvailableError` | throw/reject with it → `error.code === 'not-available'` |
| `SourceError` | `{ code: 'not-available' | 'failed', … }` — switch on `code` in error slots |
| `SourceSymbol` | the brand symbol |

Authoring rules: start the underlying work in `attach()` (not in the constructor), return
its cleanup; keep `getSnapshot()` stable between changes; call the `subscribe` listeners
after each state change. Under SSR a source stays pending (no effects run on the server).

---

## Routing

### `route(path, name, component, options?)`

Declares one route. `:param` segments become typed params (`/station/:id` →
`{ id: string }`); `*` is the catch-all. The component receives the path params as
props — or, with `options.scope`, the scope's resolved props (checked against the scope,
with the params feeding the scope's inputs).

```ts
route('/station/:stationId', 'station', Board, {
    scope: stationScope,   // optional: data resolved before the component renders
    loading: Skeleton,     // optional: same contract as island's
    error: BoardError,     // optional: same contract as island's
    wrapper: AppLayout,    // optional: layout rendered around the component
});
```

Routes live in a plain `as const` array. Register its type once for app-wide typed links
and route reads:

```ts
declare module 'rati' {
    interface RatiUserTypes {
        routes: typeof routes;
    }
}
```

### `group(defaults, routes)`

Applies shared `wrapper` / `loading` / `error` to a list of routes (a child's own option
wins). Returns the routes unchanged at the type level — spread the result into the routes
tuple; paths stay absolute.

### `RouterStore`

The router object: owns history, the active route, and navigation. A plain external store
(subscribable; no rendering).

```ts
new RouterStore(routes, options?);

interface RouterStoreOptions {
    history?: History;                                   // default: browser history
    basename?: string;                                   // mount prefix, e.g. '/admin'
    scrollRestoration?: false | ScrollRestorationOptions; // default: scroll-to-top on navigation
    hydratedState?: RouterHydratedState;                 // seed from a server render
}
```

Members:

| Member | Behavior |
| --- | --- |
| `activeRoute` | the matched route (name, params) or `null` |
| `path` / `state` | current path; per-entry navigation state |
| `navigate(to, options?)` | push. `to`: `{ name, …params }` (typed off the table) or a string |
| `replace(to, options?)` | replace — back skips the current URL |
| `getPath(to)` | build an href from a typed route reference |
| `setSearchParams(params)` | update the query string |
| `subscribe(fn)` | change notification (for non-React consumers) |
| `dispose()` | release history listeners (one router per SSR request — dispose after render) |

`navigate`/`replace` options: `keepCurrentRoute` (change the URL without re-resolving the
mounted route) and `state` (per-entry state, survives back/forward; a same-URL navigation
that changes only state still re-resolves).

### Components & hooks

| Export | Purpose |
| --- | --- |
| `<Router />` | renders the active route's component (with its `wrapper`) |
| `<Link to={…} prefetch?>` | typed link; `prefetch` preloads a lazy chunk on hover/touch |
| `<Navigate to={…} />` | declarative redirect on mount |
| `ContextualLink`, `LinkContextProvider`, `useLinkContext` | links resolved against a provided base (nested UI that builds relative links) |
| `useRouter()` | the router, subscribed — reading `activeRoute`/`path` re-renders on navigation |
| `useRouteContext(name)` | what the named route's scope provides, typed off the routes table; accepts only scope-carrying route names |

### History & scroll

| Export | Purpose |
| --- | --- |
| `createBrowserHistory()` | DOM history (default) |
| `createMemoryHistory({ url })` | server / tests |
| `History`, `HistoryLocation`, `HistoryListener`, `HistoryUpdate`, `HistoryAction` | the history contract, for custom hosts |
| `installScrollRestoration(options?)` | standalone installer; usually configured via `RouterStoreOptions.scrollRestoration` |

### `lazy(loader)`

`React.lazy` plus `.preload()`, so the router (and `<Link prefetch>`) can fetch a chunk
before rendering — whether the component is mounted bare or folded into a route. Type:
`PreloadableLazyComponent`.

### Route types

`NameToRoute` (typed `to` objects), `ExtractRouteParams<Path>`, `GenericRouteType`,
`RouteContextValueOf<Name>`, `RouteContextNames`, `RatiUserTypes` (the augmentation
interface).

---

## Stores

> Being finalized in the current iteration; the shape below is the target surface.

A minimal stores container: construct your stores in one place (the router among them),
provide the container, read it with a typed hook — including inside scope loads via
`hook()`.

| Export | Purpose |
| --- | --- |
| `StoresProvider` | provides the app's stores container |
| `createStoresHook<T>()` | builds the typed `useStores()` hook for your container type |
| `useRouter()` | reads `stores.router` (see Routing) |

The container is app-owned — a plain class whose fields are your stores. rati only needs
`router` to be one of them.

---

## `rati/ssr`

Everything a server entry needs. (`HydrationProvider` renders on the client too — mount
it on both sides so the trees match.)

| Export | Purpose |
| --- | --- |
| `prepareRoute(router)` | drive a memory-history router to its matched route (preloading a lazy component); returns `{ hydratedState }` or `null` when nothing matched |
| `createHydrationCollector()` | `{ collect, data }` — records islands' resolved promise values during `prerender` |
| `HydrationProvider` | server: `collect={collector.collect}`; client: `data={islandData}` — islands then hydrate without re-running loads |
| `Hydration`, `HydrationData`, `PreparedRoute`, `RouterHydratedState` | the payload types |

The flow (see the guide's [Server rendering](./guide.md#server-rendering)): fresh
`RouterStore` (memory history) + collector per request → `prepareRoute` →
`prerender` from `react-dom/static` (it awaits Suspense; `renderToString` cannot) → embed
`hydratedState` + `collector.data` in the HTML → the client seeds its `RouterStore` and
`HydrationProvider` from them → `router.dispose()` on the server when done.

Only async load results are dehydrated; sources stay pending under SSR and come alive
after hydration.

---

## `rati/mobx`

Optional — requires the `mobx` peer dependency; apps that never import this entry keep
MobX out of their bundle.

| Export | Purpose |
| --- | --- |
| `observableSource(fn)` | adapt a MobX derivation to a `Source` — the bridge between MobX state and scope loads |

The remaining exports (`ActiveData`, `ActiveApiData`, `remoteData`, `remoteDataKey`,
`responseKey`) are a legacy data layer pending extraction to its own package; not
recommended for new code.

---

## `rati/debug`

| Export | Purpose |
| --- | --- |
| `navTrace`, `navTraceStart`, `navTraceEnabled` | navigation-timeline tracing; toggled live via `globalThis.__DEBUG__.nav`, near-zero cost when off |
