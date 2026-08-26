# rati — the guide

rati is a **declarative data layer for React**, with typed routing and server rendering built around it.

You declare which data each screen needs. rati resolves the declaration and hands your component clean, fully-loaded, fully-typed props. No `isLoading` branches, no `data === undefined` guards, no loading-state juggling inside components — and no re-declaring types your backend already knows.

> This guide explains the ideas with small, real examples. The complete API is in the reference.md.

## The problem

This component is in every React codebase. It fetches a station, then its departures, and spends most of its lines not rendering:

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

- **The component manages loading states** it doesn't care about. Every consumer of the data re-implements the same pending/error/ready dance.
- **The dependency between the two requests is smuggled in** through `enabled:` and a `!`. The waterfall exists, but you can't see it.
- **The types fight you.** The data is `T | undefined` everywhere, even after you've checked it.

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
- The waterfall is **visible**: `departures` is declared on a later level than `station`, so it runs after it. Move a load between levels and you've changed the loading strategy without touching a component.
- The types are **clean**: `station` is `Station`, not `Station | undefined`. `ScopeProps` infers the whole prop bag from the scope — nothing is written twice.

Resolution is **all-or-nothing**: the component renders when everything is ready. A half-resolved screen is a loading screen — that's what the `loading` slot is for.

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

| You write                            | The component receives                                                      |
| ------------------------------------ | --------------------------------------------------------------------------- |
| a plain value                        | the value                                                                   |
| `() => T` or `() => Promise<T>`      | the awaited result (cached per island instance)                             |
| a `Promise<T>`                       | the awaited value                                                           |
| a `class`                            | an instance, constructed with the resolved props so far                     |
| a `Source<T>` (or `() => Source<T>`) | the live value — see §Live data: sources                                    |
| `hook(fn)`                           | whatever the hook returns — see §hook() — context, and other data libraries |

A function load takes a second argument if it wants one: the load's own **abort signal**, fired when the island discards the resolution that started it — an input changed, the island retried or refreshed, or it unmounted:

```ts
const stationScope = scope({ stationId: input<string>() })
    .load({
        departures: ({ stationId }, { signal }) =>
            fetch(`/api/departures/${stationId}`, { signal }).then((res) => res.json()),
    });
```

Ignoring it is fine — every load above does — and then a discarded request simply runs to completion the way it always did. Taking it means a station the user clicked past stops fetching. (Sources don't need one: detaching *is* their cancellation.)

The class entry is worth a second look — it turns "a store per screen" into one line:

```ts
const boardScope = scope({ stationId: input<string>() })
    .load({ departures: ({ stationId }) => api.departures.list(stationId) })
    .load({ board: BoardStore });   // new BoardStore({ stationId, departures })
```

### `.provide()` — one value for the whole subtree

By default an island provides its resolved props to every descendant (see §Reading data from below). `.provide(factory)` replaces that with a derived value — typically a store or context object built over the loaded data:

```ts
const stationScope = scope({ stationId: input<string>() })
    .load({ station: …, departures: … })
    .provide(({ station, departures }) => new StationContext(station, departures));
```

The provided value is lifecycle-managed: if it has a `[Symbol.dispose]`, rati calls it on teardown, before detaching the data it was built over.

## Islands

`island()` turns a scope into a self-contained component. Its props are exactly the scope's inputs:

```tsx
const StationBoard = island({
    scope: stationScope,     // inputs: { stationId: string }
    component: Board,        // gets the resolved props
    loading: Skeleton,       // gets { inputs }
    error: BoardError,       // gets { inputs, error, retry }
});

<StationBoard stationId="zrh-hb" />
```

When an input changes, the island re-resolves; when it unmounts, everything it started is torn down — subscriptions detached, provided values disposed.

The `error` slot receives a structured `error` — `error.code` says which flavor of failure it was (`'not-available'` for missing data, `'failed'` for an unclassified one; the whole vocabulary (reference.md §SourceError — the two levels) is short and open) — and a `retry` function:

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

Throw `NotAvailableError` in a load to signal "this doesn't exist" as data, not as a crash.

If the failure you expect is a flaky network rather than a real one, the island already tries again on its own — **retry is on by default**, and the button is the fallback rather than the plan. Two more attempts, under 500ms then under 1s apart (jittered), and the `error` slot is not rendered at all until they are spent: the island shows its loading slot meanwhile, because an island retrying is an island loading.

What earns those attempts is the error's own `retryable` flag, which your fetch layer sets when it maps a response to a failure — a 5xx or a dropped connection is worth another go, a 403 or a `not-available` is an answer, not a fault. A failure nobody classified is left alone too; `retry: { count, backoffMs }` asks for a bigger budget and covers those as well, and `retry: false` opts out. See `retry` (reference.md §retry — trying again automatically) and `SourceError` (reference.md §SourceError — the two levels).

Under server rendering a failed load ships the *loading* slot and the client re-runs it — React's own degradation, and self-healing. A page that would rather paint the error slot straight away sets `ssrErrors: 'dehydrate'` (reference.md §ssrErrors — the error slot in the server's HTML), and the server renders that slot into the HTML with the failure carried alongside it.

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

`:param` segments are typed: `/station/:stationId` produces `{ stationId: string }`, and the route's component (or scope inputs) are checked against it. `group(defaults, routes)` applies a shared `wrapper`/`loading`/`error` to a list of routes without changing their types.

Param values round-trip: they are percent-encoded into the URL and decoded back out, so a component reads the value that was navigated with — `'Zürich HB'`, not `'Z%C3%BCrich%20HB'` — and a value carrying `/`, `?` or `#` stays inside its own segment. Pass values raw; don't encode them yourself, or they will be encoded twice.

### Links and navigation

`Link`'s `to` is checked against the routes table — the name must exist and every path param must be supplied:

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

For URL changes that shouldn't re-resolve the mounted route (tabs, split panels), pass `{ keepCurrentRoute: true }`; per-entry state rides along via `{ state }` and survives back/forward.

## Reading data from below

Any descendant of an island can read what it provides — by passing the **scope**:

```ts
import { useScope } from 'rati';

function DeparturesFooter() {
    const { departures } = useScope(stationScope);
    return <span>{departures.length} departures</span>;
}
```

Because the reader imports the scope (a data module), not the component that mounted it, there's no child→parent import and no cycle. `useOptionalScope` returns `undefined` instead of throwing when there's no island above.

For routes there's a no-import variant, typed off the routes table by name:

```ts
import { useRouteContext } from 'rati';

const { station } = useRouteContext('station');
```

## Refreshing

Data goes stale: a mutation lands, the user hits "save", a panel wants fresher numbers. Any descendant of an island can re-resolve it — without tearing the screen down — through `useScopeControls`:

```tsx
import { useScopeControls } from 'rati';

function MembersToolbar() {
    const { refresh, pending } = useScopeControls(stationScope);

    async function handleRemove(id: string) {
        await api.members.remove(id);
        await refresh('departures');          // re-run one load; the screen stays up
    }

    return <Toolbar busy={pending.has('departures')} onRemove={handleRemove} />;
}
```

Two forms:

- **`refresh()`** re-resolves the whole scope — the island goes back through its loading slot, exactly like the error slot's `retry`, and whatever the old resolution still had in flight is aborted (see the signal above).
- **`refresh('departures')`** re-runs one load surgically. The previous data stays on screen while the re-fetch is in flight (`pending` reports the keys, for dimming); when it lands, downstream loads re-run **only if they read `departures` and its value actually changed** — a re-fetch that returns equal data (compared deeply) keeps the old value and identity, and nothing downstream moves. A failed re-fetch also keeps the previous data.

Per-key refresh is for promise loads; sources are live and refresh themselves. For large payloads, tell rati what "changed" means instead of paying a deep compare — mark the load with `data()`:

```ts
import { data } from 'rati';

scope().load({
    departures: data(({ station }) => api.departures.list(station.id), {
        equals: (a, b) => a.etag === b.etag,
    }),
});
```

## Loading states

An island resolves all-or-nothing, so at any moment it is showing exactly one of its three slots. `useScopeControls` reports which, from anywhere in the subtree:

```tsx
const { phase, isStale, retry } = useScopeControls(stationScope);
```

`phase` is `'loading'`, `'ready'`, or `'error'` — the island's aggregate phase, not any one load's. `retry` is the error slot's retry, reachable from anywhere (the same action as `refresh()` with no key). `isStale` belongs to the option below; `retrying` — the same object's fourth read — belongs to `retry` (reference.md §retry — trying again automatically), and is what a loading slot switches on to say *why* it is still up.

### `keepStale` — don't blank on a re-load

A param change or `refresh()` re-resolves everything, which normally throws the screen back to the loading slot — blanking content the user was in the middle of reading. `keepStale` keeps the last resolution on screen until the new one is ready:

```tsx
route('/stations/:stationId', 'station', Board, { scope: stationScope, keepStale: true });

function Board({ departures }: ScopeProps<typeof stationScope>) {
    const { isStale } = useScopeControls(stationScope);
    return <Table rows={departures} className={isStale ? 'opacity-50' : ''} />;
}
```

Between the navigation and the new data committing, the island reports `phase: 'ready', isStale: true` — content *is* on screen, it just belongs to the previous resolution. That is the pairing to gate on: a subtree showing a skeleton on `phase === 'loading'` must not flip back to it under content the user is reading.

What to know:

- **The props are the old ones.** The kept content shows the *previous* params' data, so the subtree can briefly show old data under a new URL. That is the feature; `isStale` is how you say so.
- **The continuity is visual, not instance-level.** The kept content is a fresh mount of the component (and the swap mounts another), so component-local state — `useState`, focus, an inner container's scroll position — does not survive the window. State that must survive belongs in a store (`.provide()`, which *is* kept alive) or above the island.
- **The first load has nothing to keep**, so it shows the loading slot as always.
- **An error ends the window** — the error slot replaces the stale content rather than leaving it to pass for current.
- **What is kept is the whole resolution**, not a copy of its props: its sources stay attached and its `.provide()` value stays alive and published, so `useScope` and `useRouteContext` keep working through the window. Both are released when the new resolution commits.
- **A source dropping back to pending is not a re-resolution** — that is the source's own contract, and it still shows the loading slot.

`isStale` is about the whole view. A per-key `refresh('departures')` also keeps its previous value rendered, and that one reports through `pending`.

### `loadingDelayMs` — don't flash on a fast load

The other half of the same problem. A resolution that settles in tens of milliseconds still renders its loading slot for a frame or two, and a spinner that appears and vanishes reads worse than no spinner at all. `loadingDelayMs` holds the slot back:

```tsx
island({ scope: stationScope, component: Board, loading: Skeleton, loadingDelayMs: 200 });
```

Until the deadline the island renders **nothing** on a first load, or keeps the **previous content** on a re-resolve — `keepStale`'s mechanism, borrowed for the length of the window. A resolution that beats the deadline never shows the slot at all.

What to know:

- **The deadline measures a stretch without content, not one resolution.** A second re-resolve arriving mid-window doesn't push the slot further out, and once the slot is up nothing takes it back until content returns — no blanking what the user is already looking at.
- **`phase` is `'loading'` while the slot is held back** — nothing is on screen, which is what loading is. The option changes what the island *shows*, not what it is doing. (A re-resolve's window is `phase: 'ready', isStale: true`, like `keepStale`'s, until the deadline.)
- **It is inert on the server**, which waits for the resolution regardless, and through hydration: a slot that belongs in the HTML (an `ssr: false` island, a source that stays pending server-side) is shipped and stays put.
- **`0` and absent are the same thing.**

The two options compose, and that is the point of setting both:

```tsx
route('/stations/:stationId', 'station', Board, {
    scope: stationScope,
    keepStale: true,
    loadingDelayMs: 200,
});
```

`loadingDelayMs` handles "don't flash on a fast load", `keepStale` handles "don't blank on a re-load" — so with both, the loading slot appears only for a slow **first** load. Every later resolution either beats the deadline invisibly or happens under the previous content.

## Types, end to end

You never write a prop type for loaded data — you read it off the scope:

```ts
import type { ScopeProps, ScopeInputs, ScopeComponent } from 'rati';

type BoardProps = ScopeProps<typeof stationScope>;   // resolved props
type BoardInputs = ScopeInputs<typeof stationScope>; // the input()s

const Board: ScopeComponent<typeof stationScope> = (props) => { … };
```

If your API client is typed (tRPC, Hono RPC, generated clients, hand-typed fetchers), the types flow from the backend response through the scope into the component — change a response type and the compiler points at every screen that cares.

## Live data: sources

Promises resolve once. For data that keeps changing — a websocket feed, a ticking clock, a CRDT document — a load can be a **source**: a small `pending | ready | error` state machine that the island subscribes to.

```ts
import { type Source, promiseSource, readySource } from 'rati';

const liveScope = scope({ stationId: input<string>() })
    .load({ departures: ({ stationId }) => liveDepartures(stationId) }); // returns Source<Departure[]>
```

The component still just receives `departures: Departure[]` — when the source updates, the island re-renders it with the new value. The island calls the source's `attach()` on mount and detaches on unmount, so the connection's lifetime is the screen's lifetime, with no `useEffect` in sight.

Writing a source is implementing three methods (`subscribe`, `getSnapshot`, `attach`) — see the reference.md §Sources. `readySource`, `promiseSource`, and `toSource` cover the common cases. A source that should resolve on the server too can opt in with its `ssr` marker — see §Server rendering.

## Stores and living data: `rati/data`

> **Experimental.** `rati/data` is an optional entry — it needs the `mobx` peer dependency, and its surface may still move. The reference.md §rati/data is the API station; this section teaches the model and *when to reach for which primitive*.

Everything so far loads data *per screen*: the island resolves a scope, the component gets clean props, a re-mount re-resolves. That's the right shape for read-once screen data. But some data outlives one screen and keeps changing under you — a list you edit in place, a row a websocket updates, a draft you stage before saving. For that, rati has a small set of **instance-owned primitives** you keep in your store graph:

| Reach for         | When                                                                             |
| ----------------- | -------------------------------------------------------------------------------- |
| `query`           | one value that refreshes (a detail, a count)                                     |
| `collection`      | a keyed list whose rows keep their identity across refreshes                     |
| `reconciled`      | that identity, over rows you already have — the list half of a composite payload |
| `pagedCollection` | that list, loaded in pages                                                       |
| `mutation`        | a write, with the optimistic-patch-then-refresh dance owned for you              |
| `form` + `field`  | edits staged locally before a save                                               |

One division of labor runs through all of them: **the first load comes through the island; live updates come through MobX; a refresh comes through the store; forms never touch the island at all.**

**A collection in a store.** A `collection` fetches a list once and reconciles every later refresh against it — a changed row updates its *existing* instance in place, so only the rows that actually moved re-render (selection, drag state, and refs survive). A `mutation` sits next to it, declaring what it patches optimistically and what it refreshes afterwards:

```ts
import { collection, mutation } from 'rati/data';

class StationsStore {
    stations = collection({
        fetch: (signal) => api.stations.list(signal),
        key: (station) => station.id,
    });

    rename = mutation((id: string, name: string) => api.stations.rename(id, name), {
        optimistic: (id, name) => this.stations.patchItem(id, (s) => void (s.name = name)),
        refreshes: () => [this.stations],
    });
}
```

**When the response isn't the list.** A `collection` fetches the array itself. Plenty of endpoints return the array *inside* something — `{ usefulData, stations }` — and that is a plain `query`. Give its list half the same identity story with `reconciled`, a derived view over rows you already have (no fetch, no phases of its own — the query keeps those):

```ts
class OverviewStore {
    overview = query((signal) => api.overview(signal)); // declared before the view
    stations = reconciled(() => this.overview.data?.stations ?? [], { key: (s) => s.id });
}
```

`stations.items` reconciles on every `overview.refresh()`, and a `collection` is exactly this pairing pre-wired.

**Bridged into a scope through `source()`.** A read-side primitive exposes `source()` — the same `Source` from the last section — so a scope's `.load()` awaits its *first* readiness and the island's loading/error slots cover that first load:

```ts
export const stationsScope = scope()
    .load({ stores: hook(() => useStores()) })
    .load({ stations: ({ stores }) => stores.stations.source() });
```

The resolved `stations` prop is **the collection instance itself**, not a snapshot of its rows. Once it's ready it stays ready with that same reference — later refreshes, and even refresh *failures*, are the instance's own observable state and never re-trip the island.

**The component observes it directly.** Because the prop is a live MobX object, the component reads its fields through `observer` (the standard MobX–React binding) and re-renders on the fine-grained changes — no island re-resolution. This is the one place a rati app reaches for `observer`; the core scope/island reads elsewhere don't need it.

```tsx
import { observer } from 'mobx-react-lite';
import type { ScopeProps } from 'rati';

const StationList = observer(({ stations }: ScopeProps<typeof stationsScope>) => (
    <List
        items={stations.items}
        dimmed={stations.phase === 'refreshing'} // stale-while-refetch, for free
    />
));
```

**A mutation propagates optimistically.** Calling `store.rename(id, name)` patches the row synchronously — every observer of the collection sees the new name at once — then fires the request and refreshes the collection to reconcile server truth. If the request fails, that same refresh rolls the optimistic edit back. You write the call site; the try/patch/recover choreography is owned:

```tsx
function RenameButton({ store, id, name }: { store: StationsStore; id: string; name: string }) {
    return <button onClick={() => store.rename(id, name)}>Rename</button>;
}
```

**A form stages a draft from an item.** Richer edits — a dialog with validation — belong in a `form`, seeded from data the island already resolved. The form *is* the draft: `field(...)` captures the baseline, `isDirty` compares against it, `reset()` cancels, and `submit()` calls the mutation. It's synchronous local state, so it never touches the island:

```tsx
import { form, field, required } from 'rati/data';

class RenameDialog {
    readonly form;
    readonly save;
    constructor(store: StationsStore, station: Station) {
        this.form = form({ name: field(station.name, { validate: required() }) });
        // submit() validates, runs the handler, commits the baseline on success,
        // and distributes a thrown FormError onto the fields. It never rejects, so
        // nothing at the call site has to catch.
        this.save = this.form.submit(async ({ name }) => {
            await store.rename(station.id, name);
        });
    }
}

const RenameForm = observer(({ dialog }: { dialog: RenameDialog }) => (
    <form onSubmit={(event) => { event.preventDefault(); void dialog.save(); }}>
        <TextField {...dialog.form.fields.name.props} label="Name" />
        <button type="submit" disabled={dialog.form.isSubmitting}>Save</button>
    </form>
));
```

`fields.name.props` is React Aria Components-shaped (`value` / `onChange` / `isInvalid` / `errorMessage`), so binding an input is a spread.

Note the wiring: `onSubmit` + `preventDefault`, **not** React's function `action={dialog.save}`. The seam is shaped to be action-compatible and it fits, but with controlled fields behind the inputs the action's completion reset erases the user's draft — the first trap in §With React Aria Components, which is where the rest of that story lives.

**Two notes on the edges.** A `query`/`collection` can re-fetch when a store observable it reads changes (`reactive: true`) — the type-ahead case; the reference.md §rati/data covers it and its one sharp edge (only reads *before the producer's first `await`* are tracked).

And under **SSR the primitives stay pending**: a `Source` attaches from an effect, and the server runs none — so a `rati/data`-backed screen ships its loading slot in the HTML and comes alive on hydration. That's usually right for live, interactive data, but it means `rati/data` is not the tool for server-rendered *content*; for that, a plain async load is simpler and dehydrates. Reach for `rati/data` when the data is long-lived, edited in place, or live — otherwise a `scope().load()` over your API client is the smaller thing.

### Choosing a shape

The primitives are easy to use and easy to *pick wrong*. In practice that's where the time goes: not the API, but deciding which shape a given piece of data is. The same handful of judgements keeps coming up, so here they are, each with the reason behind it.

**Is the response the array?** A `collection` fetches the rows themselves — its `fetch` returns `T[]`. Plenty of endpoints return the rows *inside* something, and a composite payload is **one value with one fetch and one error**, which is a `query`. Give its list half the identity story with `reconciled`, rather than bending the payload into a shape it isn't:

```ts
collection({ fetch: (signal) => api.stations.list(signal), key: (s) => s.id }); // → Station[]
query((signal) => api.overview(signal));                                       // → { totals, stations }
reconciled(() => this.overview.data?.stations ?? [], { key: (s) => s.id });    // its list half
pagedCollection({ fetchPage: (cursor, signal) => api.stations.page(cursor, signal), key: (s) => s.id });
```

The split is about *fetch topology*, not about lists: reconciliation is identity work over rows you hold, and it doesn't need to own the request. Forcing a composite response into a collection means either fetching it twice or inventing an array the endpoint never returned — and the sibling fields (`totals` here) end up homeless either way.

**Store-owned, or per-mount?** A read whose lifetime *is* the visit belongs to the screen: declare it as a `scope().load()` and let the island resolve it. Data that outlives one screen, is edited in place, or is shared between screens belongs to an instance in your store graph. The question that decides it: *who else looks at this, and is it still interesting after I navigate away?* If the answer is "nobody" and "no", it's a load.

Choosing store-owned doesn't cost you the island's slots — that's what `source()` is for. It bridges either way: the primitive lives in the store, and the screen still gets a first load covered by `loading`/`error`.

**`keyed` is a map, not a cache.** It has no eviction, no TTL and no size bound, so it is the right tool exactly when the key space is **bounded by something real**: the spaces you're a member of, the tabs that are open, the handful of ids a session touches. An *unbounded* key space — a result per search term, an instance per row a list might show — wants the opposite shape: **one instance whose parameters change**, driven by a `reactive: true` producer or by a scope input. A map keyed by search term is a leak with a lookup table in front of it.

**When it isn't a primitive at all.** Two shapes look like they want one and don't:

- **Derived values.** A number computed from data you already hold is a getter (a MobX `computed`), not a second `query`. Fetching it again buys a second thing to refresh and a second way to disagree with the first.
- **A one-shot read a scope level already covers.** A value the screen fetches once and drops is already handled all-or-nothing by the island. Wrapping it in a store `query` adds an instance, a phase machine and a lifetime question to something that had none.

**Identity comes at three levels**, and it's worth knowing which one you're being given:

- **Per key** — `keyed`'s contract: `get(id)` returns *that same instance* for the life of the map.
- **Within a key** — the reconciler's: a row keeps its object identity across refreshes for as long as its key does, whether the reconciler is inside a `collection` or a standalone `reconciled` view. That's what lets selection, drag state and refs survive a refresh.
- **Across keys** — deliberately none. Two keys whose payloads mention the same entity hold two independent objects, and nothing normalizes them into one. There is no global cache here; if your app needs a single canonical object per entity, it owns that itself.

## With React Aria Components

rati is headless and stack-neutral: it has no UI dependency, no adapter, and nothing in it knows what a text field is. But it is developed against one production app, and that app is built on **React Aria Components** (RAC) — so the seams between the two have been walked already, and a few of them cost real debugging. What follows is field notes, not an endorsement and not an integration: symptom, cause, and the wiring that works. On another component library they're still useful as the shape of question to ask yours.

### A function `action` erases the user's draft

**Symptom.** The user submits, the server refuses, the error message renders — and every input is empty. Same on a validation failure: the fields blank out under a row of "Required" messages, with nothing left to correct.

**Cause.** Two reasonable designs meeting badly. `submit()` never rejects — that is the contract that makes it action-compatible — so *every* submit, refused or invalid or fine, looks to React like an action that **completed**. And React resets a form when a function action settles.

That reset is a native `form.reset()`; React's value tracker turns it into a synthetic `change` on every input whose value moved; a RAC field answers by pushing itself back to its mount-time value through `onChange`. With a controlled `field` behind the input, that empty value lands in your state and the draft is gone. None of this is rati-specific or MobX-specific — it reproduces with a plain `useState` behind the same input.

**The pattern.** Submit through `onSubmit` and `preventDefault`, which React leaves alone. Put it in the form component you already own, so no call site has to remember:

```tsx
import type { FormEvent } from 'react';
import { Form as RACForm, type FormProps } from 'react-aria-components';

/** `submit` is a rati form's submit seam — wired through onSubmit, never React's action=. */
export function Form({ submit, ...props }: FormProps & { submit?: () => Promise<void> }) {
    return (
        <RACForm
            {...props}
            {...(submit && {
                onSubmit: (event: FormEvent<HTMLFormElement>) => {
                    event.preventDefault();
                    void submit();
                },
            })}
        />
    );
}

// every form in the app, then:
<Form submit={dialog.save} validationBehavior="aria">…</Form>
```

Wrapping each handler in a helper works too, and is worse: an `onSubmit` that forgets `preventDefault` looks correct and silently wipes the draft, so the behavior belongs somewhere a call site *cannot* forget it.

One consequence to plan for: with no function action there is no `useFormStatus` either. Read pending off the form — `form.isSubmitting` — which is where the rest of the state already is.

### The browser blocks submit before your validators run

**Symptom.** Your field validators never fire. The user gets a native browser tooltip instead of your messages, and the submit handler is never called at all.

**Cause.** RAC's `Form` defaults to `validationBehavior="native"`, so the browser's own constraint validation runs first and refuses the submit — before `submit()` ever reaches `validate()`.

**The pattern.** `validationBehavior="aria"` on every form whose own validators decide:

```tsx
<Form submit={login.submit} validationBehavior="aria">
    <TextField {...fields.email.props} name="email" type="email" label="Email" />
</Form>
```

Know what you're trading. In `aria` mode the form renders `noValidate`, so `type="email"`, `minLength` and friends stop constraining anything — the validator kit becomes the *only* check left. Whatever the markup used to promise has to exist in the field:

```ts
form({ email: field('', { validate: [required(), pattern(/.+@.+/, 'Enter an email address')] }) });
```

### Render props run outside your `observer`

**Symptom.** A dialog's controlled input doesn't update as the user types — it only catches up when something else re-renders — and the value that reaches the server is the last keystroke alone.

**Cause.** RAC invokes a render-prop child — `<Dialog>{({ close }) => …}</Dialog>` — from inside **its own** render, not yours. `observer` tracks what *your* component's render reads; reads inside that function belong to RAC's component, so nothing subscribes to the field.

**The pattern.** Pass children as an element, and take whatever the render prop offered (`close`) from state you own instead:

```tsx
const CreateSpaceDialog = observer(function CreateSpaceDialog({ create }: { create: CreateForm }) {
    const [isOpen, setIsOpen] = useState(false);

    return (
        <DialogTrigger isOpen={isOpen} onOpenChange={setIsOpen}>
            <Button>Create space</Button>
            <Modal>
                {/* Children as an element, not a render prop: a render prop runs inside
                    RAC's own render, so the field reads below would fall outside this
                    observer and the input would never see its own edits. */}
                <Dialog>
                    <Form submit={create.save} validationBehavior="aria">
                        <TextField {...create.form.fields.title.props} label="Title" autoFocus />
                        <Button onPress={() => setIsOpen(false)}>Cancel</Button>
                    </Form>
                </Dialog>
            </Modal>
        </DialogTrigger>
    );
});
```

Keeping the render prop is fine if you'd rather — then its body becomes its own `observer` component. The rule underneath is the general one: whatever reads the observable data has to be the thing being observed, and a callback the library runs during *its* render isn't.

### `field.props` fits a text field, not every widget

**Symptom.** The spread that works on a `TextField` doesn't type-check on a `Select`, or type-checks on a `Checkbox` and binds the wrong thing.

**Cause.** `props` is `value` / `onChange` / `isInvalid` / `errorMessage` — one shape, because widget kind is the component's business and rati keeps one field type rather than one per widget. A `Select`'s selection handler yields a `Key`, not your field's type; a `Checkbox` wants `isSelected`.

**The pattern.** Spread where it fits, bridge by hand where it doesn't — it's two lines:

```tsx
<TextField {...fields.email.props} name="email" label="Email" />

<Checkbox isSelected={fields.rememberMe.value} onChange={fields.rememberMe.setValue}>
    Remember me
</Checkbox>

<Select
    label="Role"
    selectedKey={fields.role.value}
    onSelectionChange={(key) => fields.role.setValue(key as Role)}
/>
```

Note the `name` on the text field: `props` doesn't carry one (submit reads the form object, not a `FormData`), and password managers and autofill still want it.

### Two more from the same app, not React Aria's fault

- **Reach your API client from inside the producer, not from a field initializer.** A store graph is usually built during boot — before the client exists, and before a test harness has finished standing one in — while a producer body runs at fetch time, when everything is up. `fetch: (signal) => api.jobs.list(signal)` is safe; a field initialized to `api.jobs` at construction is a boot-order bug waiting for its first cold start.
- **A `reactive` producer only tracks its synchronous prefix**, so every reactive input has to be read before the first `await` — the one sharp edge of `reactive: true`, spelled out in the reference.md §rati/data.

## `hook()` — context, and other data libraries

Some values can only come from React: context, or libraries that only expose hooks. `hook(fn)` marks a load whose function runs on every render and may call any hook:

```ts
import { hook } from 'rati';

const boardScope = scope({ stationId: input<string>() })
    .load({ stores: hook(() => useStores()) })                     // dependency injection
    .load({ user: hook(({ stationId }) => fromApollo(USER_DOC)) }); // adapt a hooks-only lib
```

This is also the escape hatch that makes rati coexist with an existing react-query or Apollo setup: wrap the hook, return a `Source`, and the rest of the screen doesn't know the difference. Note the flip side: a *plain* function load is cached and must not call hooks — if it needs one, it's a `hook()` load.

## Code splitting

`lazy()` is `React.lazy` plus a `preload()` handle the router understands:

```ts
import { lazy } from 'rati';

const Settings = lazy(() => import('./Settings'));
route('/settings', 'settings', Settings);
```

`<Link prefetch>` starts loading the chunk on hover/touch; server rendering preloads it before rendering, so the HTML is complete either way.

Built through the Vite plugin (ssr.md §Lazy routes are preloaded), a server-rendered lazy route also names its chunk in the page's `<head>` — otherwise the browser can't learn the chunk exists until the entry has run and React has resolved the component, one round trip after the HTML it could have started during. Nothing to configure, and nothing about `lazy()` changes without the plugin.

## Server rendering

A route's data resolves at render time, so the server can resolve it too: rati renders under React's `prerender`, waits for the islands' data, and **dehydrates** the resolved values into the HTML. The client feeds them back and hydrates without re-running a single load.

The whole per-request loop is one call — and the client boot mirrors it:

```tsx
// server
import { renderApp } from 'rati/ssr';

const result = await renderApp({ url, createApp });
// → { kind: 'rendered', html, status, headTags, stateScript, … }
//   | { kind: 'redirect', to, status } | { kind: 'no-match' }
```

```tsx
// client
import { readHydration } from 'rati/ssr';

const state = readHydration();
const { App } = createApp({
    history: createBrowserHistory(),
    hydratedState: state?.router,
    hydration: state
        ? { data: state.data, seeds: state.seeds, errors: state.errors }
        : undefined,
});
hydrateRoot(container, <App />);
```

The operational half — the server entry, the Vite plugin (dev + the build), the production handler, document titles and meta, response statuses and load failures, route-level redirects, and the payload contract — is the server rendering guide (ssr.md).

Two consequences worth knowing:

- Server data must be an **async** load to be dehydrated (a sync value isn't serialized).
- **Sources stay pending under SSR** by default — they're live connections, and the server runs no effects. A source-backed screen ships its loading slot in the HTML and comes alive on hydration. That's usually exactly right for live data.

A source that *can* resolve on the server opts in with its `ssr` marker — one rule, two shapes:

- **`ssr: true`** — a loader in source clothing. The server resolves it like a promise and dehydrates the value; on the client the key hydrates as that value and the loader never runs at all.
- **`ssr: { hydrate, dehydrate? }`** — a live source that can be **seeded**. The server dehydrates `dehydrate(value)` (a *seed*, carried in `collector.seeds`); the client creates the source as usual, feeds the seed to `hydrate()` before attaching, and the source starts already-ready — server HTML, no second fetch, fully live afterward.

A live source that can't seed simply stays unmarked and keeps the default behavior.

### When an island shouldn't hold the page up

`prerender` is all-or-nothing: the response waits for *every* load on the page. rati does not stream — a half-sent document is a lot of machinery for a narrow win, and it makes resolution stop being all-or-nothing, which is the model the whole framework is built on. The pressure valve is per-island instead. Set `ssr: false` and that island sits the server render out:

```tsx
island({ scope: feedScope, component: Feed, loading: FeedSkeleton, ssr: false });

route('/dashboard', 'dashboard', Dashboard, { scope: metricsScope, ssr: false });
```

The server renders the island's `loading` slot into the HTML and starts none of its loads; the browser resolves it after hydration. Reach for it when an island is below the fold, expensive, or personalized — anything whose data the first paint doesn't need. What you're trading is real: that island's content is no longer in the HTML, so it isn't there for a crawler and it costs a spinner on screen. Slow-but-important data still belongs in the blocking path.

Two details follow from the island being the unit:

- The opt-out **wins over anything inside the scope** — a source marked `ssr: true` in an `ssr: false` island stays pending on the server like any unmarked one.
- An opted-out island **can't fail server-side**, so it never contributes to the response status: no load of its can produce a 404 or a 5xx.

On a client-only app the option does nothing at all.

## App setup

Minimal setup is a router, its provider, and the outlet:

```tsx
import { createRouter, RouterOutlet, RouterProvider } from 'rati';
import { routes } from './routes';

const router = createRouter(routes);

export function App() {
    return (
        <RouterProvider router={router}>
            <RouterOutlet />
        </RouterProvider>
    );
}
```

`RouterProvider` makes the router reachable (for `<Link>`, `useRouter()`, and the outlet); `RouterOutlet` renders the active route. Anything that navigates — a nav bar, an app shell — goes inside the provider, and the outlet can sit anywhere under it.

rati ships no store container: an app's store layer is app code. A container that wants the router holds the `Router` type — it is typed off the same `declare module 'rati'` augmentation as `<Link>`, so holding it never imports the route table:

```ts
import type { Router } from 'rati';

export class AppStores {
    constructor(public router: Router) {}
    favorites = new FavoritesStore(this);
}
```

Provide the container through your own React context (a `createContext` + a `useStores` hook is all it takes), and read it anywhere — including in scope loads, via `hook()`.

## What rati is not

- **Not a fetch client.** Loads are plain async functions; bring your own API client, and its types come along for free.
- **Not a request cache.** Loads are cached per island instance (one screen, one resolution), not in a global normalized cache. If you have react-query/Apollo for caching, adapt it through `hook()` — rati is the layer between your data and your components, not a replacement for your transport.
- **Not a state manager.** For client state, use what you like; rati's core has no external dependencies, and optional MobX bindings live in `rati/mobx`.
