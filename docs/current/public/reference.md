# rati — reference

The complete public API, by entry point. For the concepts and worked examples, start with
the [guide](./guide.md).

| Entry | Contents |
| --- | --- |
| `rati` | Everything client-side: scopes, islands, routing, sources, stores. |
| `rati/ssr` | The server-facing surface: hydration, `prepareRoute`. |
| `rati/vite` | The Vite plugin: `vite dev` serves an SSR app, no server of your own. |
| `rati/server` | Production serving: a fetch request handler, plus a Node listener. |
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

### `data(fn, options?)`

Marks a function load with per-load options — the counterpart of `hook()`: `hook` says how
a load runs, `data` says what it is (a cached data load) and configures it. A bare function
load behaves exactly like `data(fn)` with no options.

```ts
scope().load({
    members: data(({ spaceId }) => api.members.list(spaceId), {
        equals: (a, b) => a.etag === b.etag,   // the refresh gate — see useScopeControls
    }),
});
```

`options.equals(previous, next)` gates `refresh(key)`: an equal re-fetch keeps the old
value (and identity) and stops the downstream cascade. Defaults to deep equality; provide
a cheaper discriminator for large payloads. Types: `DataLoad`, `DataLoadOptions`.

### Scope types

```ts
type Props   = ScopeProps<typeof s>;      // resolved props (Source<T> unwraps to T)
type Inputs  = ScopeInputs<typeof s>;     // the input() head
type Keys    = ScopeLoadKeys<typeof s>;   // load keys (Props minus Inputs) — refresh(key)'s type
type Value   = ScopeProvidesOf<typeof s>; // what useScope(s) returns
const C: ScopeComponent<typeof s> = …;    // component typed to the resolved props
```

Also exported: `Scope`, `ChainableScope`, `Input`, `HookLoad`, `DataLoad`,
`DataLoadOptions`, `ScopeProvideDef`, and the symbols `InputSymbol` / `ScopeSymbol` /
`ScopeDefinitionsSymbol` / `ScopeProvidesSymbol` (advanced: identity checks and
library-level introspection).

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

### `useScopeControls(scope)`

The nearest island's imperative controls, keyed by the scope like `useScope` (throws
outside the island's subtree):

```ts
const { refresh, pending } = useScopeControls(stationScope);

refresh(): Promise<void>;                      // whole scope — the retry mechanism
refresh(key: ScopeLoadKeys<S>): Promise<void>; // one load, surgically
pending: ReadonlySet<ScopeLoadKeys<S>>;        // keys currently re-fetching
```

`refresh()` with no key re-resolves everything (the loading slot shows again, same as the
error slot's `retry`). `refresh(key)`:

- re-runs that load with the current upstream values; the previous value **stays
  rendered** while the re-fetch is in flight — no loading slot, no blank;
- gates the result: an unchanged value (per the load's `equals` — deep by default, see
  `data()`) keeps the old value and identity and stops there;
- a changed value re-runs exactly the downstream loads whose producers read the key
  (recorded at run time), cascading by the same rules;
- targets **promise loads only** — sources are live and refresh themselves; hook loads run
  every render; static entries have no producer (each warns and no-ops);
- resolves when the key settles (its cascade may still be in flight — watch `pending`);
  a failed re-fetch keeps the previous value, logs, and still resolves.

Type: `ScopeControls<S>`.

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
    readonly ssr?: SourceSSR<T>;      // opt-in server resolution — see below
}

type SourceState<T> =
    | { status: 'pending' }
    | { status: 'ready'; value: T }
    | { status: 'error'; error: SourceError };
```

| Export | Purpose |
| --- | --- |
| `readySource(value)` | a source that is already ready |
| `promiseSource(promise, { ssr }?)` | pending until the promise settles |
| `toSource(x)` | lift a value / promise / source (idempotent on sources) |
| `isSource(x)` | type guard |
| `toSourceError(reason)` | map a thrown value to a `SourceError` |
| `NotAvailableError` | throw/reject with it → `error.code === 'not-available'` |
| `SourceError` | `{ code: 'not-available' | 'failed', … }` — switch on `code` in error slots |
| `SourceSSR` | the `ssr` marker type |
| `SourceSymbol` | the brand symbol |

Authoring rules: start the underlying work in `attach()` (not in the constructor), return
its cleanup; keep `getSnapshot()` stable between changes; call the `subscribe` listeners
after each state change.

A source that changes value re-runs the loads that read it, by the same rules a
[`refresh()`](#usescopecontrolsscope) cascade follows: the new value goes through the load's
`equals` gate (deep by default), and a changed one re-runs exactly the downstream loads whose
producers read the key. So deriving from live data in a dependent load works — it tracks:

```ts
scope()
    .load({ clock: () => clockSource })            // ticks on its own
    .load({ label: ({ clock }) => format(clock) }) // re-runs on each tick
```

A source returning to `pending` renders the loading slot instead (the levels below unmount);
recovering onto the same value re-renders them with no producer re-runs.

### SSR-capable sources — the `ssr` marker

By default a source stays pending under SSR (no effects run on the server). The marker
authorizes the server to attach it *during render*, wait for its first settle through
React's own Suspense mechanics, and dehydrate the result. One rule, two shapes:

```ts
type SourceSSR<T> =
    | true                                    // a loader: promise semantics end to end
    | {
          dehydrate?: (value: T) => unknown;  // serialize for the wire (default: the value)
          hydrate: (data: unknown) => void;   // client: seed the store, before attach()
      };
```

- **`ssr: true`** — for loader-shaped sources whose ready value is JSON-safe. Dehydrates
  as a plain value; the client hydrates the key to that value and never creates or
  attaches the source.
- **`ssr: { hydrate, dehydrate? }`** — for live sources that can be seeded. The server
  ships `dehydrate(value)` in the *seeds* payload; the client creates the source as usual
  and calls `hydrate(data)` before attaching, so its first snapshot is already ready —
  no pending gap, no double fetch, fully live afterward.

The marker is a promise of conduct: `attach()` is server-safe and the machine settles in a
reasonable time (a hung source hangs the prerender, same as a hung promise load). Server
resolution engages only under a `HydrationProvider` with a collector — resolving without
dehydration would mismatch on the client.

---

## Routing

### `route(path, name, component, options?)`

Declares one route. `:param` segments become typed params (`/station/:id` →
`{ id: string }`); `*` is the catch-all. The component receives the path params as
props — or, with `options.scope`, the scope's resolved props (checked against the scope,
with the params feeding the scope's inputs).

Param values are percent-encoded into the URL and decoded back out, so what a navigation
puts in is what the component gets, whatever characters it holds (a value containing `/`
stays one segment). Pass values raw — encoding them yourself double-encodes. A URL whose
encoding is malformed (`/station/%zz`) hands the param through undecoded and warns rather
than throwing.

**One value has no URL to carry it: a param that is exactly `.` or `..`.** A dot-only
segment is a path operator, and every browser resolves it away before the router is
reached — `/station/..` *is* `/`, so a URL built from that value would land wherever `/`
matches. Percent-encoding does not rescue it: URLs treat `%2E` as a dot for exactly this
purpose, so `/station/%2E%2E` resolves away too. `getPath` refuses the value instead of
building a URL that quietly lands elsewhere — passing `.` or `..` throws, naming the
param and the route. If a param's values can be arbitrary (filenames, user input), keep
them out of the path — put them in the query string, where a dot is ordinary — or map
them to an id first. Dots *within* a value (`a.b`, `..x`) are fine and need nothing.

```ts
route('/station/:stationId', 'station', Board, {
    scope: stationScope,   // optional: data resolved before the component renders
    loading: Skeleton,     // optional: same contract as island's
    error: BoardError,     // optional: same contract as island's
    wrapper: AppLayout,    // optional: layout rendered around the component
});
```

A route can declare itself an internal **redirect** (`RouteRedirect`): the client
router follows it with a history `replace`; on the server `prepareRoute` reports it so
the response is a real 30x before rendering. Targets: `{ name, …params }` (resolved
through the table, current search/hash kept), a literal path string, or
`(params) => target` for legacy param paths. `permanent: true` advises a 301.

```ts
route('/settings', 'settings', () => null, {
    redirect: { to: { name: 'settings-profile' }, permanent: true },
});
```

A **string** target is an absolute path (it starts with `/`; a relative one is
[refused](#routerstore)), used verbatim — so under a [`basename`](#routerstore) it must
include it: write what the URL bar should say (`to: '/admin/b'`, not `to: '/b'`). This is
the same rule `getPath` follows for a string, and the reason to prefer an object target
when the destination is a route in the table: that one is resolved through it, basename
and all. A redirect whose target resolves back to the route declaring it is a loop —
reported, with the route's own component rendered rather than followed.

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
    basename?: string;                                   // mount prefix ('/admin'): stripped before matching, prepended to hrefs
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
| `getPath(to)` | build an href from a typed route reference (params percent-encoded); throws if the name isn't in the table |
| `setSearchParams(params)` | update the query string |
| `subscribe(fn)` | change notification (for non-React consumers) |
| `dispose()` | release history listeners, and the history itself if the router created it (one router per SSR request — dispose after render) |

`navigate`/`replace` options: `keepCurrentRoute` (change the URL without re-resolving the
mounted route) and `state` (per-entry state, survives back/forward; a same-URL navigation
that changes only state still re-resolves).

**Router-facing strings are absolute path references** — they start with `/`, and anything
else is refused (`navigate`, `replace`, `<Navigate>`, a `redirect` target). The router does
not resolve a reference against the current URL: only the browser could, and the memory
history that serves SSR and tests reads the same spelling differently, so a relative string
would name two different places depending on the host. A leading `/` alone is not enough:
a string the URL parser reads as carrying an *authority* (`//host` and its spellings) names
another origin, not a path, and is refused too — the router only moves within the app, and
a redirect target travels into the server's `Location` header, where an authority the app
never chose would be an open redirect. Link external URLs with a plain `<a>`. Name a route (`{ name, …params }`,
or `getPath`) to have the table build the path, `setSearchParams` to change the query — and
where a *platform*-relative reference is what you mean, put it on a `<Link>` or a plain
anchor. That is the surface that owns one: the DOM resolves the href against the current
URL, and `<Link>` navigates to the URL the anchor resolved, so an intercepted click lands
exactly where an unintercepted one would (`href=".."` at `/a/b/c` goes to `/a/`). Active
state resolves the same way before comparing.

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
| `createMemoryHistory({ url })` | server / tests — a real entry stack, so back/forward work without a DOM |
| `History`, `HistoryLocation`, `HistoryListener`, `HistoryUpdate`, `HistoryAction` | the history contract, for custom hosts |
| `history.go(delta)`, `.back()`, `.forward()` | traverse the entry stack. Lands on an existing entry, so its `state` and `key` come back as they were, and the update arrives as `POP`. Out of range does nothing (it doesn't clamp) |
| `history.dispose?.()` | detach from the host (the browser history's `popstate`) and drop listeners. A history you inject is yours to dispose — the router only disposes one it created itself |

A traversal reports back at different times on the two histories: the memory history owns
its stack and emits before `go` returns, while the browser queues the traversal and the
`POP` arrives on a later task (via `popstate`). Code that must work on both awaits the
listener rather than reading `location` on the next line.
| `installScrollRestoration(options?)` | standalone installer; usually configured via `RouterStoreOptions.scrollRestoration` |

### `lazy(loader)`

`React.lazy` plus `.preload()`, so the router (and `<Link prefetch>`) can fetch a chunk
before rendering — whether the component is mounted bare or folded into a route. Type:
`PreloadableLazyComponent`.

It also carries a `.moduleId` — which module it imports, as the client manifest keys it.
You never write it: [`rati/vite`](#rativite)'s transform appends it as a second argument
at each call site, so a server render can name the route's chunk (`prepareRoute` surfaces
it; `renderApp` turns it into a `modulepreload`). Without the plugin it is absent, and
`lazy` behaves exactly as it always did.

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

## Head

Document metadata that needs **dedupe by depth** — the title and per-page meta. The
deepest live declaration per slot wins (a page beats a layout default); on the client
`HeadProvider` syncs `document.title` and the managed `<meta>` tags on hydration and
every navigation; on the server the winners are read after prerender (`headTags` in
`rati/ssr`, done for you by `renderApp`). Tags that don't need dedupe use native React
19 hoisting or the HTML shell — see the [server rendering guide](./ssr.md#titles-and-meta).

| Export | Purpose |
| --- | --- |
| `createHeadStore(options?)` | one store per rendered tree (per request on the server); options: `defaultTitle`, `titleTemplate(title)` |
| `<HeadProvider store?>` | provides the store + owns the client document sync; `store` may be omitted in a client-only app |
| `<Title>{string}</Title>` | declare the document title (template applies) |
| `useTitle(title)` | hook form; `null`/`undefined` declares nothing |
| `<Meta name="…" content>` / `<Meta property="…" content>` | declare a deduped meta tag (standard / Open Graph) |
| `HeadStore`, `HeadSnapshot`, `MetaTag`, `MetaProps`, `HeadStoreOptions` | the types; `store.snapshot(mode)` exposes the winners for custom sinks |

---

## `rati/ssr`

The server-facing surface. (`HydrationProvider` and `readHydration` run on the client —
mount the provider on both sides so the trees match.) The full flow with code:
[server rendering guide](./ssr.md).

| Export | Purpose |
| --- | --- |
| `renderApp({ url, createApp, assets?, onError? })` | the whole per-request loop: memory history → `createApp` → `prepareRoute` → prerender → dispose. Returns `{ kind: 'rendered', html, status, headTags, stateScript, hydration, errors, matchedCatchAll }` \| `{ kind: 'redirect', to, permanent, status }` \| `{ kind: 'no-match', status }` |
| `RenderAssets` | `{ bootstrapModules?, styleTags?, preloadTagsFor? }` — what the built client needs from the page. Normally `virtual:rati/assets` from [`rati/vite`](#rativite); `bootstrapModules` reaches the prerender, the rest joins `headTags` |
| `renderToHtml(node, { bootstrapModules?, onError? })` | drain `react-dom/static` `prerender` to a string (it awaits Suspense; `renderToString` cannot) |
| `serializeHydration(state)` | the payload as an inert `application/json` script tag (CSP-friendly, placement-free); warns outside production about values that don't survive JSON |
| `readHydration()` | client: parse the embedded payload; `null` → resolve from scratch |
| `headTags(store)` | the head store's winners as escaped HTML — call after prerender |
| `prepareRoute(router)` | drive a memory-history router to its match (preloading a lazy component); returns `{ hydratedState, matchedCatchAll, redirect?, moduleId? }` or `null` when nothing matched |
| `createHydrationCollector()` | `{ collect, collectError, data, seeds, errors }` — records islands' resolved values, live-source seeds, and failed loads during prerender |
| `HydrationProvider` | server: `collect`/`collectError`; client: `data`/`seeds` — islands then hydrate without re-running loads |
| `HydrationState`, `HydrationError`, `Hydration`, `HydrationData`, `PreparedRoute`, `RouterHydratedState`, `HYDRATION_SCRIPT_ID` | the payload/decision types |

Async load results and `ssr: true` sources dehydrate as values; `ssr: { hydrate }` sources
dehydrate as seeds; unmarked sources stay pending under SSR and come alive after hydration
(see [Sources §SSR-capable sources](#ssr-capable-sources--the-ssr-marker)). A load that
*rejects* is recorded in `errors` — statuses derive from it (`not-available` → 404); the
HTML degrades to the loading slot and the client retries the load after hydration.

---

## `rati/vite`

Optional — requires the `vite` peer dependency. Build-time only: it runs in the Vite
process and nothing from this entry reaches the browser. Walkthrough:
[server rendering guide](./ssr.md#the-vite-plugin).

| Export | Purpose |
| --- | --- |
| `ratiSsr({ entry?, clientEntry?, template?, placeholders?, outDir? })` | dev: render every request through the app's server entry inside Vite's own dev server — result kinds mapped onto the response, `transformIndexHtml` on the shell (so HMR lives), failures in Vite's error overlay. build: both environments on one `vite build`, plus `virtual:rati/assets` |
| `virtual:rati/assets` (generated) | `{ bootstrapModules, styleTags, preloadTagsFor(moduleId) }` — the built client's tags, inlined into the server bundle so production reads no manifest. Hand it to `renderApp` as `assets`. Types: `/// <reference types="rati/vite/client" />` |

`entry` defaults to `/src/entry-server.tsx`, `clientEntry` to `/src/entry-client.tsx`
(the client build's input — so `index.html` is a shell, not a build input), `template` to
`index.html` (Vite-root relative), `placeholders` to `{ head: '<!--app-head-->', html:
'<!--app-html-->', state: '<!--app-state-->' }`, `outDir` to `{ client: 'dist/client',
server: 'dist/server' }`. A `render` returning a whole `<html>` document is spliced into
rather than filled — no option to set. Anything the app renders with nowhere to go
throws rather than serving a page that silently lost it.

A `lazy()` route's client chunk is preloaded in the page it is rendered on: the plugin
transforms each `lazy()` call site to record the module it imports, and resolves it
through the client manifest. It is additive metadata — `lazy()` behaves identically
without the plugin.

---

## `rati/server`

Production only — dev is the [plugin](#rativite)'s job, so there is no branch in here.
Walkthrough: [server rendering guide](./ssr.md#the-production-handler).

Nothing in here imports React — `react` is an optional peer, so a server-only workspace
can install rati for `createRequestHandler` alone and never add it.

| Export | Purpose |
| --- | --- |
| `createRequestHandler({ render, template?, assets?, placeholders?, onError? })` | → `(request: Request) => Promise<Response>`. The result kinds as HTTP: 30x with `Location`, the rendered page at its derived status, 404 for `no-match`, and a 500 CSR fallback if `render` throws |
| `serve({ handler, staticDir?, port? })` | → `Promise<Server>`. A `node:http` listener for the handler, with minimal static serving. Dependency-free |

`render` is the server entry's (the [Layer-1 contract](#ratissr)). `template` is your HTML
shell as a string — a whole-document app needs none. `placeholders` must match
`ratiSsr({ placeholders })`. `onError` defaults to `console.error`.

`assets` is the same `virtual:rati/assets` you pass `renderApp` — **re-export it from the
server entry** to reach it here, since the virtual module exists only inside the build. It
is used for one thing: if `render` throws (an error outside every island — a failing
*load* is caught by its island and carried in the status), the handler serves the shell
with the assets tags, an empty root and no payload, at status 500. The client entry finds
no payload, calls `createRoot`, and resolves from scratch. A whole-document app has no
template to fill, so the assets are synthesized into a minimal document instead — the
unset `template` is the signal. Without `assets` the answer is a plain-text 500.

Fetch is the only interface: `app.all('*', (c) => handler(c.req.raw))` for Hono,
`export default { fetch: handler }` for Vercel/Bun/Deno/workers. `serve()` is for the one
host that isn't fetch-shaped; it maps `staticDir` files onto their URL paths with correct
MIME types and sends everything else to the handler, so an unknown path reaches your app's
404 page. `port` defaults to `$PORT`, then 3000. No compression, caching or clustering —
put a CDN in front for real traffic.

---

## `rati/mobx`

Optional — requires the `mobx` peer dependency; apps that never import this entry keep
MobX out of their bundle.

| Export | Purpose |
| --- | --- |
| `observableSource(getState, attach?, { ssr }?)` | adapt a MobX derivation to a `Source` — the bridge between MobX state and scope loads; `ssr` forwards the [SSR marker](#ssr-capable-sources--the-ssr-marker) |

The MobX-shaped data primitives (`query`, `collection`, `mutation`, `form`) live in the
[`rati/data`](#ratidata) entry, which builds on this bridge. (The former legacy exports —
`ActiveData`, `remoteData`, `remoteDataKey`, `responseKey` — are gone; `rati/data` is
their successor.)

---

## `rati/data`

**Experimental.** Optional — requires the `mobx` peer dependency, like
[`rati/mobx`](#ratimobx) (whose `observableSource` it builds on). The successor of the
legacy data layer and of app-side `FetchStore` families; design record:
`docs/archive/directions-2026-07/data-package.md`. The surface may still move; it is
intended to eventually extract into a companion package.

Data in an app has four moments; each primitive owns exactly one, plus one for fetch
topology:

| Export | Purpose |
| --- | --- |
| `query(producer, { debounce?, reactive? }?)` | read one value: one async producer (`(signal: AbortSignal) => Promise<T>`), honest phases (`idle → loading → ready / refreshing / error`), race-guarded |
| `collection({ fetch, key, equals?, into?, debounce?, reactive? })` | read a keyed set: identity-stable reconciliation, `patchItem`/`upsert`/`insert`/`remove` |
| `pagedCollection({ fetchPage, key, equals?, into?, reactive? })` | read in pages: pages *are* queries (per-page phase/error/retry), structural `hasMore`, cursor re-anchoring `refresh()` |
| `mutation(perform, { optimistic?, refreshes?, onError? }?)` | write: callable with observable `isPending`/`error`, optimistic patch + refresh choreography |
| `form(fields)`, `field(initial, { validate?, equals? }?)` | stage local edits: per-field baseline (`isDirty`/`reset()`/`commit()`), validate-on-submit, RAC-shaped `props`, action-compatible `submit()` |
| `required`, `minLength`, `maxLength`, `min`, `max`, `pattern` | the validator kit — a validator is just `(value: T) => string \| undefined`; all but `required` skip empty values |
| `FormError` | thrown by a submit handler to distribute `fieldErrors` onto matching fields (the API layer decides where a 422 becomes one) |

Instance-owned data: each primitive is an object living in your store graph; sharing
happens by sharing the instance — no keyed cache, no normalized store. Everything that
fails normalizes to [`SourceError`](#sources), so one `code` switch
works from island error slots to in-content badges.

**The scope seam.** Read-side primitives expose `source()`: pending until the first
ready, then ready forever with **the instance itself** as the resolved prop — later
refreshes and refresh errors are the instance's own observable state and never re-trip
the island. `attach()` triggers `load()` (ensure semantics); detach does nothing — the
store owns the data's lifetime.

```ts
class SpacesManagementStore {
    spaces = collection({ fetch: (signal) => fetchSpaces(signal), key: (s) => s.spaceId });

    rename = mutation(renameRequest, {
        optimistic: (id: string, title: string) =>
            this.spaces.patchItem(id, (s) => void (s.title = title)),
        refreshes: () => [this.spaces],
    });
}

export const spacesScope = scope()
    .load({ stores: hook(() => useStores()) })
    .load({ spaces: ({ stores }) => stores.spacesManagement.spaces.source() });

const SpacesPage = observer(({ spaces }: ScopeProps<typeof spacesScope>) => (
    <List items={spaces.items} dimmed={spaces.query.phase === 'refreshing'} />
));
```

Division of labor: the island covers loading/error for the **first** resolution; the
primitives' phases drive everything after — `refreshing` for stale display, per-page
phases for pagination rows, `isSubmitting` for buttons. `query.load()` is idempotent
*ensure* (fetches from `idle`/`error`, no-ops when `ready`, dedupes in flight);
`refresh()` is the only re-fetch and keeps stale data visible, even through a refresh
failure. Under SSR the primitives stay pending (a `Source` attaches in effects) — this
entry is for the interactive app, not the SSR path.

**Reactive params** (`reactive: true`, opt-in). A `query` marked `reactive` re-fetches when
the observables its producer reads **synchronously** change — the type-ahead / filter case,
replacing a store's manual `load()`-after-every-setter. The re-run is a `refresh()`, so
`debounce` coalesces the burst; `collection` forwards both options to its query.

```ts
const results = query(
    async (signal) => {
        const term = store.searchTerm; // tracked — a change re-fetches
        await tick();
        const extra = store.extraFilter; // NOT tracked — read after the first await
        return api.search(term, extra, signal);
    },
    { reactive: true, debounce: { waitMs: 200 } },
);
```

The tracked window is the producer's **synchronous prefix only** — reads after the first
`await` are outside MobX's tracking, so destructure every reactive dependency at the top.
`pagedCollection`'s `reactive` is *reset*, not refresh: a tracked param change invalidates
every cursor, so the list resets to the first page (the island drops to its loading slot).
The rule for choosing between this and the scope's [selective refresh](#usescopecontrolsscope):
a value in the URL belongs to the scope (a route-param change re-resolves); a value in a
store observable belongs to the reactive query.

Forms never touch the island: they are synchronous local state seeded from data the
island already resolved — `form({ title: field(space.title, { validate: required() }) })`
is the draft; `submit(handler)` validates, runs the handler (typically awaiting
mutations), commits on success, distributes a thrown `FormError` onto fields, and lands
anything else on `form.error`. The returned function never rejects, so it is usable
directly as `<form action={store.save}>`.

---

## `rati/debug`

| Export | Purpose |
| --- | --- |
| `navTrace`, `navTraceStart`, `navTraceEnabled` | navigation-timeline tracing; toggled live via `globalThis.__DEBUG__.nav`, near-zero cost when off |
