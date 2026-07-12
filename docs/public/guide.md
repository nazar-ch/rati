# rati — the guide

rati is a **declarative data layer for React**, with typed routing and server rendering
built around it.

You declare which data each screen needs. rati resolves the declaration and hands your
component clean, fully-loaded, fully-typed props. No `isLoading` branches, no
`data === undefined` guards, no loading-state juggling inside components — and no
re-declaring types your backend already knows.

> This guide explains the ideas with small, real examples. The complete API is in the
> [reference](./reference.md).

## The problem

This component is in every React codebase. It fetches a station, then its departures, and
spends most of its lines not rendering:

```tsx
function StationBoard({ stationId }: { stationId: string }) {
    const station = useQuery(['station', stationId], () => api.stations.get(stationId));
    const departures = useQuery(
        ['departures', station.data?.id],
        () => api.departures.list(station.data!.id),
        { enabled: !!station.data },
    );

    if (station.isLoading || departures.isLoading) return <Skeleton />;
    if (station.error || departures.error) return <Oops />;
    if (!station.data || !departures.data) return null; // TS still isn't convinced

    return <Board station={station.data} departures={departures.data} />;
}
```

Three problems hide in those lines:

- **The component manages loading states** it doesn't care about. Every consumer of the
  data re-implements the same pending/error/ready dance.
- **The dependency between the two requests is smuggled in** through `enabled:` and a `!`.
  The waterfall exists, but you can't see it.
- **The types fight you.** The data is `T | undefined` everywhere, even after you've
  checked it.

## The idea

rati splits that component into two declarations:

**A scope** — which data this screen needs, and in what order:

```ts
import { scope, input } from 'rati';

export const stationScope = scope({
        stationId: input<string>(),                                   // what the screen is given
    })
    .load({ station: ({ stationId }) => api.stations.get(stationId) }) // level 1
    .load({ departures: ({ station }) => api.departures.list(station.id) }); // level 2 — sees level 1
```

**An island** — that scope mounted with a component and its loading/error slots:

```tsx
import { island } from 'rati';

export const StationBoard = island({
    scope: stationScope,
    component: Board,      // receives { stationId, station, departures } — all resolved
    loading: Skeleton,     // shown while resolving
    error: BoardError,     // shown on failure, with a retry handle
});

// <StationBoard stationId="zrh-hb" />
```

And the component becomes just the rendering:

```tsx
import type { ScopeProps } from 'rati';

function Board({ station, departures }: ScopeProps<typeof stationScope>) {
    return (
        <section>
            <h1>{station.name}</h1>
            <DepartureList departures={departures} />
        </section>
    );
}
```

Everything the first version did by hand is now structural:

- Loading and error handling live in the island's **slots** — once, outside the component.
- The waterfall is **visible**: `departures` is declared on a later level than `station`,
  so it runs after it. Move a load between levels and you've changed the loading strategy
  without touching a component.
- The types are **clean**: `station` is `Station`, not `Station | undefined`. `ScopeProps`
  infers the whole prop bag from the scope — nothing is written twice.

Resolution is **all-or-nothing**: the component renders when everything is ready. A
half-resolved screen is a loading screen — that's what the `loading` slot is for.

## Scopes

A scope is a plain value describing data: **inputs** at the head, then `.load()` levels.

```ts
const stationScope = scope({
        stationId: input<string>(),          // inputs: what the island is given as props
    })
    .load({ station: ({ stationId }) => api.stations.get(stationId) })
    .load({
        // one level, two keys: these resolve in parallel
        departures: ({ station }) => api.departures.list(station.id),
        weather: ({ station }) => api.weather.at(station.coords),
    });
```

Two rules give you full control over the loading shape:

- Keys **within** a level resolve **in parallel**.
- Levels resolve **in sequence**, and each level sees everything resolved before it.

That's the entire waterfall language. Where you declare a load *is* its scheduling.

A `.load()` entry can be more than an async function:

| You write | The component receives |
| --- | --- |
| a plain value | the value |
| `() => T` or `() => Promise<T>` | the awaited result (cached per island instance) |
| a `Promise<T>` | the awaited value |
| a `class` | an instance, constructed with the resolved props so far |
| a `Source<T>` (or `() => Source<T>`) | the live value — see [Live data](#live-data-sources) |
| `hook(fn)` | whatever the hook returns — see [`hook()`](#hook--context-and-other-data-libraries) |

The class entry is worth a second look — it turns "a store per screen" into one line:

```ts
const boardScope = scope({ stationId: input<string>() })
    .load({ departures: ({ stationId }) => api.departures.list(stationId) })
    .load({ board: BoardStore });   // new BoardStore({ stationId, departures })
```

### `.provide()` — one value for the whole subtree

By default an island provides its resolved props to every descendant (see
[Reading data from below](#reading-data-from-below)). `.provide(factory)` replaces that
with a derived value — typically a store or context object built over the loaded data:

```ts
const stationScope = scope({ stationId: input<string>() })
    .load({ station: …, departures: … })
    .provide(({ station, departures }) => new StationContext(station, departures));
```

The provided value is lifecycle-managed: if it has a `[Symbol.dispose]`, rati calls it on
teardown, before detaching the data it was built over.

## Islands

`island()` turns a scope into a self-contained component. Its props are exactly the
scope's inputs:

```tsx
const StationBoard = island({
    scope: stationScope,     // inputs: { stationId: string }
    component: Board,        // gets the resolved props
    loading: Skeleton,       // gets { inputs }
    error: BoardError,       // gets { inputs, error, retry }
});

<StationBoard stationId="zrh-hb" />
```

When an input changes, the island re-resolves; when it unmounts, everything it started is
torn down — subscriptions detached, provided values disposed.

The `error` slot receives a structured `error` (`error.code` is `'not-available'` for
missing data, `'failed'` for everything else) and a `retry` function:

```tsx
import type { ScopeInputs, SourceError } from 'rati';

function BoardError({ inputs, error, retry }: {
    inputs: ScopeInputs<typeof stationScope>;
    error: SourceError;
    retry: () => void;
}) {
    if (error.code === 'not-available') return <NotFound station={inputs.stationId} />;
    return <button onClick={retry}>Try again</button>;
}
```

Throw `NotAvailableError` in a load to signal "this doesn't exist" as data, not as a
crash.

## Routes

A route is an island bound to a URL — same scope, same slots, plus a path:

```tsx
import { route, group } from 'rati';

export const routes = [
    route('/', 'home', Home),
    route('/station/:stationId', 'station', Board, {
        scope: stationScope,      // :stationId feeds the scope's stationId input
        loading: Skeleton,
        error: BoardError,
        wrapper: AppLayout,
    }),
    route('*', '404', NotFound),
] as const;

// Register the table's type once; links and route reads are typed app-wide.
declare module 'rati' {
    interface RatiUserTypes {
        routes: typeof routes;
    }
}
```

`:param` segments are typed: `/station/:stationId` produces `{ stationId: string }`, and
the route's component (or scope inputs) are checked against it. `group(defaults, routes)`
applies a shared `wrapper`/`loading`/`error` to a list of routes without changing their
types.

### Links and navigation

`Link`'s `to` is checked against the routes table — the name must exist and every path
param must be supplied:

```tsx
import { Link } from 'rati';

<Link to={{ name: 'station', stationId: 'zrh-hb' }}>Zürich HB</Link>
<Link to="/about" />                                    // plain strings work too
<Link to={{ name: 'station', stationId }} prefetch />   // preload the chunk on hover
```

Programmatic navigation goes through the router:

```tsx
import { useRouter } from 'rati';

const router = useRouter();
router.navigate({ name: 'station', stationId: 'zrh-hb' });
router.replace('/auth/login');
router.setSearchParams({ q: 'zurich' });
```

For URL changes that shouldn't re-resolve the mounted route (tabs, split panels), pass
`{ keepCurrentRoute: true }`; per-entry state rides along via `{ state }` and survives
back/forward.

## Reading data from below

Any descendant of an island can read what it provides — by passing the **scope**:

```ts
import { useScope } from 'rati';

function DeparturesFooter() {
    const { departures } = useScope(stationScope);
    return <span>{departures.length} departures</span>;
}
```

Because the reader imports the scope (a data module), not the component that mounted it,
there's no child→parent import and no cycle. `useOptionalScope` returns `undefined`
instead of throwing when there's no island above.

For routes there's a no-import variant, typed off the routes table by name:

```ts
import { useRouteContext } from 'rati';

const { station } = useRouteContext('station');
```

## Types, end to end

You never write a prop type for loaded data — you read it off the scope:

```ts
import type { ScopeProps, ScopeInputs, ScopeComponent } from 'rati';

type BoardProps = ScopeProps<typeof stationScope>;   // resolved props
type BoardInputs = ScopeInputs<typeof stationScope>; // the input()s

const Board: ScopeComponent<typeof stationScope> = (props) => { … };
```

If your API client is typed (tRPC, Hono RPC, generated clients, hand-typed fetchers), the
types flow from the backend response through the scope into the component — change a
response type and the compiler points at every screen that cares.

## Live data: sources

Promises resolve once. For data that keeps changing — a websocket feed, a ticking clock, a
CRDT document — a load can be a **source**: a small `pending | ready | error` state
machine that the island subscribes to.

```ts
import { type Source, promiseSource, readySource } from 'rati';

const liveScope = scope({ stationId: input<string>() })
    .load({ departures: ({ stationId }) => liveDepartures(stationId) }); // returns Source<Departure[]>
```

The component still just receives `departures: Departure[]` — when the source updates, the
island re-renders it with the new value. The island calls the source's `attach()` on mount
and detaches on unmount, so the connection's lifetime is the screen's lifetime, with no
`useEffect` in sight.

Writing a source is implementing three methods (`subscribe`, `getSnapshot`, `attach`) —
see the [reference](./reference.md#sources). `readySource`, `promiseSource`, and
`toSource` cover the common cases.

## `hook()` — context, and other data libraries

Some values can only come from React: context, or libraries that only expose hooks.
`hook(fn)` marks a load whose function runs on every render and may call any hook:

```ts
import { hook } from 'rati';

const boardScope = scope({ stationId: input<string>() })
    .load({ stores: hook(() => useStores()) })                     // dependency injection
    .load({ user: hook(({ stationId }) => fromApollo(USER_DOC)) }); // adapt a hooks-only lib
```

This is also the escape hatch that makes rati coexist with an existing react-query or
Apollo setup: wrap the hook, return a `Source`, and the rest of the screen doesn't know
the difference. Note the flip side: a *plain* function load is cached and must not call
hooks — if it needs one, it's a `hook()` load.

## Code splitting

`lazy()` is `React.lazy` plus a `preload()` handle the router understands:

```ts
import { lazy } from 'rati';

const Settings = lazy(() => import('./Settings'));
route('/settings', 'settings', Settings);
```

`<Link prefetch>` starts loading the chunk on hover/touch; server rendering preloads it
before rendering.

## Server rendering

A route's data resolves at render time, so the server can resolve it too: rati renders
under React's `prerender`, waits for the islands' data, and **dehydrates** the resolved
values into the HTML. The client feeds them back and hydrates without re-running a single
load.

```tsx
// server
import { prepareRoute, HydrationProvider, createHydrationCollector } from 'rati/ssr';
import { prerender } from 'react-dom/static';

const router = new RouterStore(routes, { history: createMemoryHistory({ url }) });
const prepared = await prepareRoute(router);
const collector = createHydrationCollector();

const { prelude } = await prerender(
    <HydrationProvider collect={collector.collect}>
        <App router={router} />
    </HydrationProvider>,
);
// embed prepared.hydratedState + collector.data in the HTML
```

```tsx
// client
const router = new RouterStore(routes, { hydratedState });
hydrateRoot(container,
    <HydrationProvider data={islandData}>
        <App router={router} />
    </HydrationProvider>,
);
```

Two consequences worth knowing:

- Server data must be an **async** load to be dehydrated (a sync value isn't serialized).
- **Sources stay pending under SSR** — they're live connections, and the server runs no
  effects. A source-backed screen ships its loading slot in the HTML and comes alive on
  hydration. That's usually exactly right for live data.

## App setup

Minimal setup is a router and the `Router` component:

```tsx
import { Router, RouterStore, StoresProvider } from 'rati';
import { routes } from './routes';

const router = new RouterStore(routes);

export function App() {
    return (
        <StoresProvider stores={{ router }}>
            <Router />
        </StoresProvider>
    );
}
```

Apps with their own store layer put those stores in the same container and read them
anywhere (including in scope loads, via `hook()`):

```ts
import { createStoresHook } from 'rati';

export class AppStores {
    constructor(public router: AppRouter) {}
    favorites = new FavoritesStore(this);
}

export const useStores = createStoresHook<AppStores>();
```

Note: the stores surface is being finalized in the current iteration — see the reference
for the up-to-date names.

## What rati is not

- **Not a fetch client.** Loads are plain async functions; bring your own API client, and
  its types come along for free.
- **Not a request cache.** Loads are cached per island instance (one screen, one
  resolution), not in a global normalized cache. If you have react-query/Apollo for
  caching, adapt it through `hook()` — rati is the layer between your data and your
  components, not a replacement for your transport.
- **Not a state manager.** For client state, use what you like; rati's core has no
  external dependencies, and optional MobX bindings live in `rati/mobx`.
