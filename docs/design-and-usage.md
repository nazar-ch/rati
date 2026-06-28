# rati — design & usage

rati is a small TypeScript frontend framework for React: a type-safe router, a
declarative data-loading model, and SSR/hydration, sharing one plain-English vocabulary.
The core is reactivity-agnostic (it runs on React's `useSyncExternalStore`); optional MobX
bindings live in `rati/mobx`.

> Implementation notes (the resolver, the value channel, SSR dehydration, the internal
> `mandala` core) live in [internals.md](./internals.md). Future-facing explorations are in
> [research/](./research/).

## Mental model

- A **scope** is a declarative spec of *which data go where* — input names bound to
  promises, sources, hooks, classes and plain values, resolved level by level (a visible
  waterfall) into clean, fully-loaded props. A scope is a plain value, not a loader.
- An **island** mounts a scope: it pairs the scope with a component plus loading/error
  slots, resolves the data, and provides the resolved value to its subtree.
- A **route** is the same thing bound to a URL: `route(...)` builds an island specialized
  to a path, fed the path params.

One vocabulary, all plain English: **scope, prop, load, provide, hook, source, island,
route.**

```
scope({ inputs }).load({ data }).provide(factory?)   →  a Scope (a value)
island({ scope, component, loading, error })          →  a component
route(path, name, component, { scope, … })            →  the same, on a URL
useScope(scope)                                        →  read what it provides, below
```

---

## App setup

```tsx
import { RootStore, RootStoreProvider, WebRouterStore, Router } from 'rati';
import { routes } from './routes';

const router = new WebRouterStore({}, routes);
const root = new RootStore({ router });

function App() {
    return (
        <RootStoreProvider rootStore={root}>
            <Router />
        </RootStoreProvider>
    );
}
```

`WebRouterStore` owns history, the active route, and navigation. `<Router/>` renders the
active route's component (with its optional `wrapper`). `RootStore` is the store root;
extend it with your own stores and expose typed hooks via `createUseStoresHook`.

---

## Routing

Routes are a plain `as const` array. Register the table's type once so links and route
context are typed app-wide:

```tsx
import { route, Navigate } from 'rati';

export const routes = [
    route('/', 'home', Home),
    route('/~:space/:pageSlug/:pageId', 'page', PageBody, {
        scope: pageScope,        // data this route resolves before rendering
        loading: PageSkeleton,
        error: PageError,
        wrapper: AppLayout,
    }),
    route('/settings', 'settings', () => <Navigate to="/settings/account" />),
    route('*', '404', NotFound),
] as const;

// One augmentation makes `Link`'s `to` and `useRouteContext` typed off the table.
declare module 'rati' {
    interface RatiUserTypes {
        routes: typeof routes;
    }
}
```

`route(path, name, component, options?)`:

- **`path`** — `:param` segments become typed route params (e.g. `/:pageId` → `{ pageId:
  string }`). `*` is the catch-all.
- **`component`** — receives the route params as props. With `options.scope` it receives
  the scope's *resolved* props instead, and is checked against the scope.
- **`options`** — `scope`, `loading`, `error` (the data slots, identical to `island`'s),
  and `wrapper` (a layout rendered around the component).

### Links & navigation

```tsx
import { Link } from 'rati';

<Link to={{ name: 'page', space: 'acme', pageSlug: 'spec', pageId }}>Open</Link>
<Link to="/settings" />               // a plain string also works
<Link to={{ name: 'page', … }} prefetch />   // start loading the chunk on hover/touch
```

`to` is type-checked against the routes table: the `name` must exist and all its path
params must be supplied. Programmatic navigation goes through the router:

```tsx
const router = useWebRouter();
router.navigate({ name: 'home' });           // push
router.replace('/auth/login');               // replace (back skips the current URL)
router.setSearchParams({ q: 'x' });          // update the query string
```

`navigate`/`replace` also take `{ keepCurrentRoute, state }`:

```tsx
// Shallow: update the URL but keep the mounted route (no re-resolve). replace()
// when it shouldn't grow the back stack (editor tabs); navigate() when it should
// (e.g. switching focus between split panels — back/forward then steps the focus).
router.replace('/editor/fileB', { keepCurrentRoute: true });
router.navigate('/users/1', { keepCurrentRoute: true, state: { panelId } });

// Per-entry state survives back/forward and is read via router.state. A
// navigation that changes only state (same URL) still re-resolves the route, so
// stepping between two entries that share a URL is visible to route-keyed consumers.
router.navigate('/users/1', { state: { panelId } });
```

---

## Scopes — declarative data

Build a scope head-first: the head declares **inputs** with `prop<T>()`; each `.load({…})`
adds a dependent level that sees the prior levels' resolved values.

```ts
import { scope, prop, hook } from 'rati';

export const pageScope = scope({
        space: prop<string>(),          // inputs (island props / route params), diffed by value
        pageId: prop<Base64Uuid>(),
    })
    .load({ stores: hook(() => useStores()) })                 // DI — a hook load (see below)
    .load({ spaceId: ({ space, stores }) => resolveId(stores, space) })   // dependent level
    .load({                                                     // parallel level (keyed by spaceId)
        tree: ({ stores, spaceId }) => stores.trees.source(spaceId),
        pageDoc: ({ stores, spaceId, pageId }) => stores.pages.source(pageId, spaceId),
    })
    .provide(({ tree, pageDoc }) => new PageContext(pageDoc, tree));   // terminal (optional)
```

A `.load()` entry is one of:

| Entry | Becomes | Resolved prop |
| --- | --- | --- |
| plain value | a value | the value |
| `() => value` / `() => Promise<T>` | a cached data load | `T` (awaited) |
| `Promise<T>` | a cached data load | `T` |
| `class` | constructed with the resolved props | the instance |
| `Source<T>` (or `() => Source<T>`) | a live load the island attaches/detaches | `T` when ready |
| `hook(fn)` | a hook load — see below | `fn`'s return (a `Source<T>` unwraps to `T`) |

Keys **within** a level resolve in parallel; levels resolve **in sequence** — that's the
waterfall, expressed by *where* a prop is declared.

### `.provide()` — what the subtree reads

By default the island provides its **resolved props** to its subtree. `.provide(factory)`
replaces that with `factory(resolvedProps)` — a derived, lifecycle-managed value (a store,
a context object) that the island disposes (`[Symbol.dispose]`) on teardown, before the
sources it was built over detach. Pass `{ provideTo: AppContext }` to also publish the
value into an app-owned React context.

### `hook()` — DI and adapting hook-based libraries

`hook(fn)` marks a load whose `fn` runs **every render** (never cached), so it may call any
React hook. Use it for dependency injection (read stores/services from context) and to
adapt external hook-based data libs (Apollo, react-query, SWR) into a `Source`:

```ts
scope({ id: prop<Uuid>() })
    .load({ stores: hook(() => useStores()) })
    .load({ user: hook(({ id }) => fromApollo(USER_DOC, { id })) });   // returns a Source<User>
```

A `hook()` load owns its own subscription lifecycle; rati never attaches/detaches it. A
bare function load that calls a hook is a bug — it would be cached and its hook run once.

---

## Islands

`island()` builds a standalone unit from a scope. Its props are exactly the scope's
`prop()` inputs:

```tsx
import { island } from 'rati';

const UserCard = island({
    scope: userScope,        // scope({ userId: prop<string>() }).load({ user: … })
    component: UserBody,     // receives the clean resolved props
    loading: Spinner,        // receives { params } (the scope inputs)
    error: ErrorCard,        // receives { params, error: SourceError, retry }
});

// <UserCard userId="42" />
```

A route with a `scope` is the same unit on a URL — there is no separate island module to
write; `route(path, name, body, { scope })` folds them together.

---

## Reading provided data

A descendant reads what an island/route provides by passing the **scope** — the scope is a
plain data module, so the reader never imports the component that renders it (no
child→parent reference, no import cycle):

```ts
import { useScope, useOptionalScope } from 'rati';

const ctx = useScope(pageScope);          // the .provide() value, or the resolved props
const ctx = useOptionalScope(pageScope);  // …or undefined when not under the island
```

For **route** islands, `useRouteContext(name)` is the no-import convenience — type the call
off the routes table by name instead of importing the scope:

```ts
import { useRouteContext } from 'rati';

const { pageContext } = useRouteContext('page');   // typed from the 'page' route's scope
```

Only context-bearing (scope-carrying) route names are accepted, and the return type is
inferred from that route's scope — no separate registration.

> Islands built from the **same** scope share one value channel, so a reader gets the
> nearest one (ordinary React context semantics). If two such islands are never nested,
> each subtree reads its own value.

---

## Types

Read prop and param types straight off the scope value — no hand-written prop types,
inferred end to end:

```ts
import type { ScopeProps, ScopeParams, ScopeComponent } from 'rati';

type Props = ScopeProps<typeof pageScope>;     // the clean resolved props
type Params = ScopeParams<typeof pageScope>;   // the inputs (island props / slot `params`)

const PageBody: ScopeComponent<typeof pageScope> = (props) => { … };
```

`Source<T>` (and `hook(...)` returning `Source<T>`) unwrap to `T` in `ScopeProps`.

---

## Sources

A **source** is the reactive data primitive an island observes — a live
`pending | ready | error` state machine. CRDT resources, REST loaders, and plain promises
all implement the same interface, so the island never knows what's behind a prop.

```ts
import {
    type Source, type SourceState, type SourceError,
    readySource, promiseSource, toSource, isSource,
    NotAvailableError, toSourceError, SourceSymbol,
} from 'rati';

interface Source<T> {
    readonly [SourceSymbol]: true;
    subscribe(onChange: () => void): () => void;  // useSyncExternalStore-shaped
    getSnapshot(): SourceState<T>;                 // stable ref while unchanged
    attach(): () => void;                          // start/hold the work; returns a detach fn
}
```

- `readySource(value)` — already-ready. `promiseSource(promise)` — pending → ready/error.
  `toSource(value | promise | source)` — lift anything (idempotent on sources).
- A load throwing `NotAvailableError` (or a promise rejecting with it) maps to
  `error.code === 'not-available'`; other failures map to `'failed'`. The error slot
  switches on `error.code`. `toSourceError(reason)` does the mapping.
- Authoring a live source: implement `subscribe`/`getSnapshot` (the island reads it through
  `useSyncExternalStore`) and start the underlying work in `attach()`, returning a detach
  function. The island calls `attach()` on mount and detaches on unmount / input change.
  `getSnapshot()` must return a stable reference while the state is unchanged. To back a
  source with a MobX observable instead, use `observableSource` from `rati/mobx`.

---

## Code splitting

`lazy()` wraps a dynamic import like `React.lazy`, but the returned component carries a
`.preload()` so the router can prefetch its chunk (`<Link prefetch>`, `prepareRoute`)
whether the component is mounted bare or folded into a route island.

```ts
import { lazy } from 'rati';
const Settings = lazy(() => import('./Settings'));
route('/settings', 'settings', Settings);
```

---

## SSR & hydration

The data engine resolves *promise* loads on the server (under a Suspense-awaiting render)
and dehydrates their values so the client hydrates without re-fetching or re-suspending.
*Sources* stay client-only (they're live, not serializable).

**Server:**

```tsx
import { prepareRoute, IslandHydrationProvider, createIslandHydrationCollector } from 'rati';
import { prerender } from 'react-dom/static';

const router = new WebRouterStore({}, routes, { history: createMemoryHistory({ url }) });
const prepared = await prepareRoute(router);          // routing snapshot for the client
const collector = createIslandHydrationCollector();

const { prelude } = await prerender(
    <IslandHydrationProvider collect={collector.collect}>
        <RootStoreProvider rootStore={root}><Router /></RootStoreProvider>
    </IslandHydrationProvider>
);
// embed `prepared.hydratedState` (routing) and `collector.data` (island data) in the HTML
```

**Client:**

```tsx
import { hydrateRoot } from 'react-dom/client';

const router = new WebRouterStore({}, routes, { hydratedState });   // seeds the active route
hydrateRoot(container,
    <IslandHydrationProvider data={islandData}>
        <RootStoreProvider rootStore={root}><Router /></RootStoreProvider>
    </IslandHydrationProvider>
);
```

`hydratedState` makes the first client render match the server's active route synchronously;
`IslandHydrationProvider data={…}` lets each island short-circuit its dehydrated promise
values. Both providers render no DOM, so mounting them on both sides keeps the trees
identical.

---

## Path aliasing

The app mounts under a `basename`:

```ts
new WebRouterStore({}, routes, { basename: '/admin' });
```

Route definitions stay rooted at `/`; the basename is stripped before matching and
prepended when generating link `href`s.
