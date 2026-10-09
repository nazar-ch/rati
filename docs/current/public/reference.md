# rati — reference

The complete public API, by entry point. For the concepts and worked examples, start with the guide.md.

| Entry               | Contents                                                                                                                               |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `rati`              | Everything client-side: scopes, islands, routing, sources, stores.                                                                     |
| `rati/ssr`          | The server-facing surface: hydration, `prepareRoute`.                                                                                  |
| `rati/vite`         | The Vite plugin: `vite dev` serves an SSR app, no server of your own.                                                                  |
| `rati/server`       | Production serving: a fetch request handler, plus a Node listener.                                                                     |
| `rati/mobx`         | Optional MobX bindings (`observableSource`) and the legacy data layer.                                                                 |
| `rati/debug`        | Opt-in debug tooling (`navTrace`, `dataTrace`).                                                                                        |
| `rati/testing`      | Test utilities: `deferred`/`flush`/`controllableSource`, island/router/stores render harnesses, an SSR round-trip kit (test-env only). |
| `rati/testing/data` | The `rati/data` half of the test kit: `controllableProducer`, `controllableQuery` (test-env only; separate because it imports MobX).   |

> **Status:** first public iteration. The stores container surface (§Stores) is being finalized; names there may still move.

---

## Scopes

### `scope(inputs)`

Starts a scope from a head of named inputs. Returns a chainable scope value.

```ts
const s = scope({ stationId: input<string>(), limit: input<number>() });
```

### `input<T>()`

Declares one typed input in a scope head. Inputs arrive as the island's props (or a route's path params) and are diffed by value — a changed input re-resolves the scope.

### `.load(level)`

Adds one resolution level. Keys within a level resolve in parallel; levels resolve in sequence, and each level's functions receive everything resolved so far (inputs + all previous levels) as their argument.

Accepted entry shapes:

| Entry                                        | Behavior                                                      | Resolved prop                                        |
| -------------------------------------------- | ------------------------------------------------------------- | ---------------------------------------------------- |
| plain value                                  | passed through                                                | the value                                            |
| `(props, context?) => T` / `… => Promise<T>` | called once per resolution, result cached per island instance | `T` (awaited)                                        |
| `Promise<T>`                                 | awaited                                                       | `T`                                                  |
| a class                                      | constructed with the resolved props so far                    | the instance                                         |
| `Source<T>` or `(props) => Source<T>`        | attached on mount, detached on unmount/input change           | `T` when ready                                       |
| `hook(fn)`                                   | `fn` runs every render, may call hooks                        | `fn`'s return; a returned `Source<T>` unwraps to `T` |

A plain function load must not call React hooks (it is cached and would run its hook once) — use `hook()` for that.

### The load context — `(props, { signal })`

A function load may declare a second parameter, a `LoadContext`:

```ts
type LoadContext = { readonly signal: AbortSignal };

scope({ stationId: input<string>() }).load({
    departures: ({ stationId }, { signal }) => api.departures.list(stationId, { signal }),
});
```

`signal` fires when the resolution that started the load is **discarded**: an input changed, `retry()` or `refresh()` re-resolved the whole scope, or the island unmounted. It does not fire on a re-render, and not on `refresh(key)` — a selective refresh replaces one load *inside* the current resolution, and the re-run receives the same signal. Under a server render it is created and never fires (there is no remount and no unmount).

Declaring the parameter is optional and changes nothing else: a one-parameter load keeps its exact behavior, and a load that takes the signal but ignores it runs to completion as before. `hook()` loads and sources don't get one — a hook owns its own lifecycle, and a source's `detach()` is already its cancellation. A cancelled load's rejection is swallowed by the island (it has no reader left), so aborting is silent by design.

### `.provide(factory, options?)`

Terminal. Replaces what the island provides to its subtree (by default: the resolved props) with `factory(resolvedProps)`. The value is lifecycle-managed — if it implements `[Symbol.dispose]`, it is disposed on island teardown, before the sources it was built over detach. `options.provideTo: Context` additionally publishes the value into an app-owned React context.

### `hook(fn)`

Marks a load as hook-based: `fn` runs on every render (never cached) and may call any React hook. Use it for dependency injection (`hook(() => useStores())`) and for adapting hook-based data libraries. `fn` receives the resolved props so far. A `hook()` load owns its own subscription lifecycle; rati never attaches or detaches it.

### `data(fn, options?)`

Marks a function load with per-load options — the counterpart of `hook()`: `hook` says how a load runs, `data` says what it is (a cached data load) and configures it. A bare function load behaves exactly like `data(fn)` with no options.

```ts
scope().load({
    members: data(({ spaceId }) => api.members.list(spaceId), {
        equals: (a, b) => a.etag === b.etag,   // the refresh gate — see useScopeControls
    }),
});
```

`options.equals(previous, next)` gates `refresh(key)`: an equal re-fetch keeps the old value (and identity) and stops the downstream cascade. Defaults to deep equality; provide a cheaper discriminator for large payloads. Types: `DataLoad`, `DataLoadOptions`.

### Scope types

```ts
type Props   = ScopeProps<typeof s>;      // resolved props (Source<T> unwraps to T)
type Inputs  = ScopeInputs<typeof s>;     // the input() head
type Keys    = ScopeLoadKeys<typeof s>;   // load keys (Props minus Inputs) — refresh(key)'s type
type Value   = ScopeProvidesOf<typeof s>; // what useScope(s) returns
const C: ScopeComponent<typeof s> = …;    // component typed to the resolved props
```

Also exported: `Scope`, `ChainableScope`, `Input`, `HookLoad`, `DataLoad`, `DataLoadOptions`, `LoadContext`, `ScopeProvideDef`, and the symbols `InputSymbol` / `ScopeSymbol` / `ScopeDefinitionsSymbol` / `ScopeProvidesSymbol` (advanced: identity checks and library-level introspection).

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
    ssr,            // optional: boolean, default true — resolve during a server render?
    keepStale,      // optional: boolean, default false — keep the last content while re-resolving?
    loadingDelayMs, // optional: number, default 0 — hold the loading slot back this long
    retry,          // optional: { count, backoffMs? } | false — automatic retry, on by default
    ssrErrors,      // optional: 'retry' (default) | 'dehydrate' — what SSR does with a failure
});
```

- Without `loading`, the island renders nothing while resolving.
- Without `error`, a failure throws to the nearest ErrorBoundary.
- `retry` re-mounts the island's inner tree: fresh promises, fresh sources.
- Types: `IslandComponent<S>`, `IslandConfig<S>`.

### `ssr: false` — sitting out the server render

A server render is all-or-nothing: every promise load on the page is awaited before the first byte goes out. `ssr: false` takes one island out of that — the server renders its `loading` slot into the HTML and starts none of its loads; the client renders that same slot through hydration, then resolves normally.

```ts
island({ scope: feedScope, component: Feed, loading: FeedSkeleton, ssr: false });
```

- **The whole island opts out**, loads and sources alike. A source marked `ssr: true` (§SSR-capable sources — the ssr marker) inside an `ssr: false` island stays pending on the server: the island-level decision wins, and there is no per-load opt-out (resolution is all-or-nothing by design).
- **Nothing reaches the payload**, so nothing reaches the server's error signal either — an opted-out island can't produce the 404/5xx a server-side load failure would (see response statuses (ssr.md §Response statuses, and load failures)).
- **Client-only apps are unaffected** — with no server in the picture the option does nothing, and the island resolves on its first render as always.

See the guide's server rendering (guide.md §Server rendering) section for when to reach for it.

### `keepStale` — keeping the previous content

A param change or `refresh()` re-resolves the whole scope, which normally shows the `loading` slot again. `keepStale: true` keeps the last committed resolution on screen until the new one commits, then swaps — stale-while-revalidate, per island.

```ts
island({ scope: stationScope, component: Board, loading: Skeleton, keepStale: true });
```

- **`useScopeControls(scope).isStale`** is true for exactly that window, and `phase` stays `'ready'` — see §useScopeControls(scope).
- **The kept content renders the previous params' props**, so the subtree can briefly show old data under a new URL. `isStale` is how it says so. The continuity is visual, not instance-level: the kept content is a fresh mount of the component and the swap mounts another, so component-local state does not survive the window — a store (`.provide()`) does.
- **First load is unchanged** (nothing to keep), and an **error ends the window**: the `error` slot replaces the stale content rather than letting it pass for current.
- **The whole resolution is kept, not a copy of its props.** Its sources stay attached and its `.provide()` value stays alive and published, so `useScope` / `useRouteContext` keep working across the window; both are released — dispose, then detach — once the new resolution commits.
- **A source returning to pending is not a re-resolution** and still shows the loading slot.
- **Under SSR the option is inert** — the server never re-resolves; dehydration is unchanged.
- **On a route**, the RouterOutlet keys the page by name rather than by navigation, so a param change re-renders the same island instead of replacing it. Navigating to a *different* route still remounts, so nothing is carried across pages.

### `loadingDelayMs` — holding the loading slot back

A resolution that settles in tens of milliseconds still renders its `loading` slot for a frame or two, which reads as a flash. `loadingDelayMs` renders **nothing** until the deadline on a first load, or keeps the **previous content** on a re-resolve (`keepStale`'s mechanism, borrowed for the length of the window); a resolution that beats the deadline never shows the slot.

```ts
island({ scope: stationScope, component: Board, loading: Skeleton, loadingDelayMs: 200 });
```

- **`0` and absent are identical** — no window, no timer, nothing kept.
- **The deadline measures a stretch without content**, not one resolution: a superseding re-resolve doesn't restart it, and once the slot is on screen nothing takes it back until content returns.
- **`phase` is `'loading'` while the slot is held back** (nothing is on screen, which is what loading is). A re-resolve's window reads `phase: 'ready', isStale: true` like `keepStale`'s, until the deadline.
- **The kept run is released at the deadline** — dispose, then detach, the same order the swap uses. Set `keepStale` too to hold it for the whole re-resolution, in which case the slot appears only for a slow *first* load.
- **Under SSR the option is inert** — the server waits for the resolution regardless, and dehydration is unchanged. A slot that belongs in the HTML (an `ssr: false` island, a source that stays pending server-side) is shipped and survives hydration unblanked.
- **On a route**, the RouterOutlet keys the page by name for the same reason `keepStale` does.

### `retry` — trying again automatically

A flaky backend makes every consumer write the same retry button, so the island writes it for you: **the policy is on by default**, with no `retry` option anywhere. An island whose resolution fails with a failure your app classified `retryable: true` (§SourceError — the two levels) takes two more attempts of its own before it shows the `error` slot.

```ts
island({ scope: stationScope, component: Board, loading: Skeleton, error: BoardError });
// a 5xx or a dropped connection → two more goes, jittered. A 403 → the error slot, now.
```

That is safe only because the failure says which kind it is, so the gate is:

| Failure                            | Default (no option)              | `retry: { count, … }`      | `retry: false` |
| ---------------------------------- | -------------------------------- | -------------------------- | -------------- |
| `retryable: true` (a 5xx, network) | retried                          | retried                    | no             |
| `retryable: false` (403, 404, 422) | **no** — the error slot, at once | **no**                     | no             |
| unclassified (a bare `throw`)      | **no**                           | retried (`code: 'failed'`) | no             |

**Classifying at your transport edge is how you buy the default.** An app that classifies nothing behaves exactly as it did before the default existed — default-on retry over unclassified failures would hammer its 404s, which is the thing worth avoiding.

Ask for more with the option — a bigger budget, and the broader reach over unclassified failures:

```ts
island({
    scope: stationScope,
    component: Board,
    loading: Skeleton,
    error: BoardError,
    retry: { count: 3, backoffMs: 500 },  // or `false` to opt out entirely
});
```

- **The backoff is jittered.** `backoffMs` (default 500) is the first *ceiling*; it doubles per attempt and is capped at 10s, and each wait is a random draw from `[0, ceiling]`, counted from the failure it follows. A fixed schedule brings every island that failed in the same backend blip back on the same tick — a small thundering herd at a server already struggling.
- **A retry in progress is not an error.** The `error` slot is not rendered at all while the policy works — the island shows its `loading` slot (or the kept run, under `keepStale`), exactly as for any other re-resolution. It comes up only once the budget is spent. (Under `keepStale` each attempt remounts the kept content — invisible for identical output, but see that option's note on instance continuity.)
- **`useScopeControls(scope).retrying`** is the attempt in flight (`1`, `2`, …) and `0` whenever none is — including in the error slot, which is a spent budget, not a retry. `phase` is unaffected: an island retrying is an island resolving.
- **The manual `retry` buys a fresh budget**, so the error slot's button (and `useScopeControls().retry`) works after exhaustion and starts the policy over. A human asking again is new information.
- **The budget is per failure streak.** It is restored when the island commits content, and when its inputs change — which also cancels a countdown belonging to the old ones.
- **Client-only.** A server render takes its one attempt per request and reports the failure as always (see response statuses — ssr.md §Response statuses, and load failures); the client's own resolution then runs the policy — including over a failure the server dehydrated (§ssrErrors — the error slot in the server's HTML), since `retryable` crosses the wire.
- **`count: 0` and `false` are identical** — both opt out. Types: `RetryOption` (`RetryOptions | false`).
- rati never sees response headers, so there is no `Retry-After` / 429 plumbing: a rate limiter's advice reaches the policy only as `retryable`.

### `ssrErrors` — the error slot in the server's HTML

React runs no error boundary during a server render, so a load that fails there has always degraded the same way: React abandons the failing Suspense boundary, the HTML carries the `loading` slot with a client-retry marker, and the client re-runs the load on hydration. That is `'retry'`, the default — self-healing, and non-deterministic. `'dehydrate'` renders the `error` slot into the HTML instead and carries the failure over in the payload, so the client hydrates straight onto that slot.

```ts
island({
    scope: orderScope,
    component: OrderCard,
    loading: Skeleton,
    error: OrderError,
    ssrErrors: 'dehydrate',
});
```

- **The client does not re-run the load.** It hydrates the failed cell to its error state, which reaches the `error` slot through the same boundary a client-side failure does — with `retry` armed. Pressing it resolves the island again, load and all.
- **What crosses the wire is `code`, `message` and `retryable`.** `cause` is dropped: a live `Error` doesn't survive JSON, and a server-side cause chain isn't the client's business. The `message` *is* written into the HTML — a load whose failures carry backend text should say something else before rejecting.
- **The response status is unchanged.** Every failure is recorded in either mode, and `renderApp` derives the status from it — a 500 with a rendered error slot is still a 500 (see response statuses — ssr.md §Response statuses, and load failures).
- **Without an `error` slot there is nothing to paint deterministically**, so the throw stands and the server degrades exactly as `'retry'` does. The failure still crosses the wire, so the client surfaces it through the nearest outer ErrorBoundary instead of silently re-running the load.
- **It needs the payload.** Under a bare `prerender` with no `HydrationProvider` — and on a client-only render — the option does nothing, for the same reason the source-side §SSR-capable sources — the ssr marker is gated the same way: a first paint that hydration contradicts a moment later is worse than the degradation it replaces.
- **With §retry — trying again automatically configured, the policy picks a dehydrated failure up** like any other — it asks whether this is a `failed` it still has budget for, and where the failure came from is not part of that question. So the error slot the HTML shipped is replaced by the `loading` slot on the first client render, and the island retries. Set both deliberately: the deterministic paint is then the server's only.
- **In development React logs the caught error to the console**, as it does for anything an error boundary catches. Nothing is broken; an island that failed on the server is being loud about it.

### `useScope(scope)` / `useOptionalScope(scope)`

Read what the nearest island built from `scope` provides — the `.provide()` value, or the resolved props. `useScope` throws outside such an island; `useOptionalScope` returns `undefined`. Islands built from the same scope share one channel; a reader gets the nearest one (React context semantics).

### `useScopeControls(scope)`

The nearest island's imperative controls, keyed by the scope like `useScope` (throws outside the island's subtree):

```ts
const { refresh, pending, phase, isStale, retrying, retry } = useScopeControls(stationScope);

refresh(): Promise<void>;                      // whole scope — the retry mechanism
refresh(key: ScopeLoadKeys<S>): Promise<void>; // one load, surgically
pending: ReadonlySet<ScopeLoadKeys<S>>;        // keys currently re-fetching
phase: 'loading' | 'ready' | 'error';          // which slot is on screen
isStale: boolean;                              // …and is it the previous resolution's?
retrying: number;                              // the `retry` policy's attempt in flight, else 0
retry: () => void;                             // the error slot's retry, from anywhere
```

`refresh()` with no key re-resolves everything (the loading slot shows again, same as the error slot's `retry`). `refresh(key)`:

- re-runs that load with the current upstream values; the previous value **stays rendered** while the re-fetch is in flight — no loading slot, no blank;
- gates the result: an unchanged value (per the load's `equals` — deep by default, see `data()`) keeps the old value and identity and stops there;
- a changed value re-runs exactly the downstream loads whose producers read the key (recorded at run time), cascading by the same rules;
- targets **promise loads only** — sources are live and refresh themselves; hook loads run every render; static entries have no producer (each warns and no-ops);
- resolves when the key settles (its cascade may still be in flight — watch `pending`); a failed re-fetch keeps the previous value, logs, and still resolves.

**The status half.** `phase` is the island's *aggregate* phase — resolution is all-or-nothing, so there is no per-load phase to read. A §keepStale — keeping the previous content window reports `'ready'` with `isStale: true`: content is on screen, it just belongs to the previous resolution. Gate skeletons on `phase === 'loading'` and dimming on `isStale`, and the two compose without fighting. `isStale` is view-wide; a per-key `refresh(key)` reports through `pending` instead. `retry` is the same action as `refresh()` with no key, named for the error-slot prop it mirrors so a subtree can offer the affordance without being the slot.

Type: `ScopeControls<S>`; the phase union is exported as `IslandPhase`.

---

## Sources

A source is the live-data primitive: an external `pending → ready | error` state machine that islands read through `useSyncExternalStore`.

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

| Export                             | Purpose                                                 |
| ---------------------------------- | ------------------------------------------------------- |
| `readySource(value)`               | a source that is already ready                          |
| `promiseSource(promise, { ssr }?)` | pending until the promise settles                       |
| `toSource(x)`                      | lift a value / promise / source (idempotent on sources) |
| `isSource(x)`                      | type guard                                              |
| `toSourceError(reason)`            | map a thrown value to a `SourceError`                   |
| `NotAvailableError`                | throw/reject with it → `error.code === 'not-available'` |
| `SourceError`                      | the unified failure — see §SourceError — the two levels |
| `SourceErrorCode`                  | the blessed `code` vocabulary (an open set)             |
| `SourceSSR`                        | the `ssr` marker type                                   |
| `SourceSymbol`                     | the brand symbol                                        |

Authoring rules: start the underlying work in `attach()` (not in the constructor), return its cleanup; keep `getSnapshot()` stable between changes; call the `subscribe` listeners after each state change.

### `SourceError` — the two levels

Every failure — a rejected load, a source that errored, a throw in a class constructor — normalizes to one shape, in two levels:

```ts
interface SourceError {
    code: SourceErrorCode;  // the flavor: what an error slot switches on
    message?: string;
    cause?: unknown;
    retryable?: boolean;    // the axis: transient (true) / terminal (false) / unclassified
}
```

- **`retryable` is the top level** — the transient/terminal axis, and the only thing the automatic §retry — trying again automatically policy consults. `true` = a blip worth another attempt; `false` = an answer, not a fault; **absent** = the app never classified it.
- **`code` is the flavor** — what the error slot renders on. The blessed vocabulary, with the HTTP status it usually comes from:

| `code`          | Meaning                          | Typical origin             | Class     |
| --------------- | -------------------------------- | -------------------------- | --------- |
| `not-available` | the thing does not exist         | 404 / 410                  | terminal  |
| `forbidden`     | not yours, or not signed in      | 401 / 403                  | terminal  |
| `invalid`       | the request itself is wrong      | 400 / 422                  | terminal  |
| `unreachable`   | the network never got there      | fetch threw, DNS, offline  | transient |
| `failed`        | anything else — and the fallback | 5xx, an unclassified throw | transient |

The set is **open**: `SourceErrorCode` is those five plus `(string & {})`, so you get completion on them and can still coin `'rate-limited'` without augmenting anything.

**Classification is yours, at the transport edge.** rati is transport-neutral — it ships no fetch helper and never sees a status code — so the status → `code` / `retryable` mapping lives in the one function your app already funnels responses through. The seam is plain: any thrown `Error` carrying a string `code` (and optionally a boolean `retryable`) maps through `toSourceError` with both intact, no subclass of rati's required.

```ts
// your app's edge — jnana's okJson.ts is the worked example
export async function okJson(response: Response) {
    if (response.ok) return response.json();
    throw Object.assign(new Error(await response.text()), {
        code: CODES[response.status] ?? 'failed',  // 403 → 'forbidden', …
        retryable: response.status >= 500 || response.status === 429,
    });
}
```

A load that classifies nothing still works: a plain `throw new Error(…)` is `{ code: 'failed' }` with `retryable` absent, and `NotAvailableError` is `{ code: 'not-available' }` as it always was.

A source that changes value re-runs the loads that read it, by the same rules a `refresh()` (§useScopeControls(scope)) cascade follows: the new value goes through the load's `equals` gate (deep by default), and a changed one re-runs exactly the downstream loads whose producers read the key. So deriving from live data in a dependent load works — it tracks:

```ts
scope()
    .load({ clock: () => clockSource })            // ticks on its own
    .load({ label: ({ clock }) => format(clock) }) // re-runs on each tick
```

A source returning to `pending` renders the loading slot instead (the levels below unmount); recovering onto the same value re-renders them with no producer re-runs.

### SSR-capable sources — the `ssr` marker

By default a source stays pending under SSR (no effects run on the server). The marker authorizes the server to attach it *during render*, wait for its first settle through React's own Suspense mechanics, and dehydrate the result. One rule, two shapes:

```ts
type SourceSSR<T> =
    | true                                    // a loader: promise semantics end to end
    | {
          dehydrate?: (value: T) => unknown;  // serialize for the wire (default: the value)
          hydrate: (data: unknown) => void;   // client: seed the store, before attach()
      };
```

- **`ssr: true`** — for loader-shaped sources whose ready value is JSON-safe. Dehydrates as a plain value; the client hydrates the key to that value and never creates or attaches the source.
- **`ssr: { hydrate, dehydrate? }`** — for live sources that can be seeded. The server ships `dehydrate(value)` in the *seeds* payload; the client creates the source as usual and calls `hydrate(data)` before attaching, so its first snapshot is already ready — no pending gap, no double fetch, fully live afterward.

The marker is a promise of conduct: `attach()` is server-safe and the machine settles in a reasonable time (a hung source hangs the prerender, same as a hung promise load). Server resolution engages only under a `HydrationProvider` with a collector — resolving without dehydration would mismatch on the client.

---

## Routing

### `route(path, name, component, options?)`

Declares one route. `:param` segments become typed params (`/station/:id` → `{ id: string }`); `*` is the catch-all. The component receives the path params as props — or, with `options.scope`, the scope's resolved props (checked against the scope, with the params feeding the scope's inputs).

Param values are percent-encoded into the URL and decoded back out, so what a navigation puts in is what the component gets, whatever characters it holds (a value containing `/` stays one segment). Pass values raw — encoding them yourself double-encodes. A URL whose encoding is malformed (`/station/%zz`) hands the param through undecoded and warns rather than throwing.

**One value has no URL to carry it: a param that is exactly `.` or `..`.** A dot-only segment is a path operator, and every browser resolves it away before the router is reached — `/station/..` *is* `/`, so a URL built from that value would land wherever `/` matches. Percent-encoding does not rescue it: URLs treat `%2E` as a dot for exactly this purpose, so `/station/%2E%2E` resolves away too.

`getPath` refuses the value instead of building a URL that quietly lands elsewhere — passing `.` or `..` throws, naming the param and the route. If a param's values can be arbitrary (filenames, user input), keep them out of the path — put them in the query string, where a dot is ordinary — or map them to an id first. Dots *within* a value (`a.b`, `..x`) are fine and need nothing.

```ts
route('/station/:stationId', 'station', Board, {
    scope: stationScope,   // optional: data resolved before the component renders
    loading: Skeleton,     // optional: same contract as island's
    error: BoardError,     // optional: same contract as island's
    wrapper: AppLayout,    // optional: layout rendered around the component
    ssr: false,            // optional: same contract as island's (needs `scope`)
    keepStale: true,       // optional: same contract as island's (needs `scope`)
    loadingDelayMs: 200,   // optional: same contract as island's (needs `scope`)
    retry: { count: 2, backoffMs: 500 },  // optional: same contract as island's
    ssrErrors: 'dehydrate', // optional: same contract as island's (needs `scope`)
});
```

A route can declare itself an internal **redirect** (`RouteRedirect`): the client router follows it with a history `replace`; on the server `prepareRoute` reports it so the response is a real 30x before rendering. Targets: `{ name, …params }` (resolved through the table, current search/hash kept), a literal path string, or `(params) => target` for legacy param paths. `permanent: true` advises a 301.

```ts
route('/settings', 'settings', () => null, {
    redirect: { to: { name: 'settings-profile' }, permanent: true },
});
```

A **string** target is an absolute path (it starts with `/`; a relative one is refused), used verbatim — so under a `basename` (§`createRouter(routes, options?)` → `Router`) it must include it: write what the URL bar should say (`to: '/admin/b'`, not `to: '/b'`). This is the same rule `getPath` follows for a string, and the reason to prefer an object target when the destination is a route in the table: that one is resolved through it, basename and all. A redirect whose target resolves back to the route declaring it is a loop — reported, with the route's own component rendered rather than followed.

Routes live in a plain `as const` array. Register its type once for app-wide typed links and route reads:

```ts
declare module 'rati' {
    interface RatiUserTypes {
        routes: typeof routes;
    }
}
```

### `group(defaults, routes)`

Applies shared `wrapper` / `loading` / `error` to a list of routes (a child's own option wins). Returns the routes unchanged at the type level — spread the result into the routes tuple; paths stay absolute. A child's own `ssr` / `keepStale` / `loadingDelayMs` / `retry` / `ssrErrors` survives the group's rebuild; the group has no default of its own for any of them — they are per-route judgments, not shared presentation.

### `createRouter(routes, options?)` → `Router`

Builds the router: a plain external store (subscribable; no rendering) that owns history, the active route, and navigation. One per app on the client; one per request on the server (with a memory `history`).

```ts
const router = createRouter(routes, options?);

interface RouterOptions {
    history?: History;                                   // default: browser history
    basename?: string;                                   // mount prefix ('/admin'): stripped before matching, prepended to hrefs
    scrollRestoration?: false | ScrollRestorationOptions; // default: scroll-to-top on navigation
    hydratedState?: RouterHydratedState;                 // seed from a server render
}
```

The `Router` type is **table-blind**: navigation targets and `activeRoute` are typed off the `RatiUserTypes` augmentation (the same source `<Link>`'s `to` reads), never off an imported route table. That is what makes it safe to hold anywhere — a store container included — without dragging the route components' types into the holder's own type. `createRouter` takes no type parameter for the same reason.

Members:

| Member                             | Behavior                                                                                                                                                                                                   |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `activeRoute`                      | the matched route or `null` — a union discriminated by `name`, so matching on `activeRoute.name` narrows `routeParams`                                                                                     |
| `path` / `state`                   | current path; per-entry navigation state                                                                                                                                                                   |
| `search` / `hash` / `searchParams` | the query string (raw and parsed) and fragment                                                                                                                                                             |
| `navigate(to, options?)`           | push. `to`: `{ name, …params }` (typed off the augmentation) or a string                                                                                                                                   |
| `replace(to, options?)`            | replace — back skips the current URL                                                                                                                                                                       |
| `getPath(to)`                      | build an href from a typed route reference (params percent-encoded); throws if the name isn't in the table                                                                                                 |
| `setSearchParams(params)`          | update the query string                                                                                                                                                                                    |
| `go(delta)`                        | traverse the history stack — lands as a POP and resolves the restored route; out of range does nothing. Browser traversal is async (memory history's is sync): subscribe rather than read on the next line |
| `back()` / `forward()`             | `go(-1)` / `go(1)`                                                                                                                                                                                         |
| `isPath(path)`                     | whether a `getPath`-style path names the current route                                                                                                                                                     |
| `preloadRoute(path)`               | start loading the matching `lazy()` route's chunk, without navigating                                                                                                                                      |
| `subscribe(fn)` / `getSnapshot()`  | change notification (`useSyncExternalStore`-shaped, for non-React consumers too)                                                                                                                           |
| `dispose()`                        | release history listeners, and the history itself if the router created it (one router per SSR request — dispose after render)                                                                             |

`navigate`/`replace` options: `keepCurrentRoute` (change the URL without re-resolving the mounted route) and `state` (per-entry state, survives back/forward; a same-URL navigation that changes only state still re-resolves).

**Router-facing strings are absolute path references** — they start with `/`, and anything else is refused (`navigate`, `replace`, `<Navigate>`, a `redirect` target). The router does not resolve a reference against the current URL: only the browser could, and the memory history that serves SSR and tests reads the same spelling differently, so a relative string would name two different places depending on the host.

A leading `/` alone is not enough: a string the URL parser reads as carrying an *authority* (`//host` and its spellings) names another origin, not a path, and is refused too — the router only moves within the app, and a redirect target travels into the server's `Location` header, where an authority the app never chose would be an open redirect. Link external URLs with a plain `<a>`.

Name a route (`{ name, …params }`, or `getPath`) to have the table build the path, `setSearchParams` to change the query — and where a *platform*-relative reference is what you mean, put it on a `<Link>` or a plain anchor. That is the surface that owns one: the DOM resolves the href against the current URL, and `<Link>` navigates to the URL the anchor resolved, so an intercepted click lands exactly where an unintercepted one would (`href=".."` at `/a/b/c` goes to `/a/`). Active state resolves the same way before comparing.

### Components & hooks

| Export                                                    | Purpose                                                                                                    |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `<RouterProvider router={…}>`                             | provides the router to the tree — wrap everything that navigates, shells included                          |
| `<RouterOutlet />`                                        | renders the active route's component (with its `wrapper`); one per app, anywhere under the provider        |
| `<Link to={…} prefetch?>`                                 | typed link; `prefetch` preloads a lazy chunk on hover/touch                                                |
| `<Navigate to={…} />`                                     | declarative redirect on mount                                                                              |
| `ContextualLink`, `LinkContextProvider`, `useLinkContext` | links resolved against a provided base (nested UI that builds relative links)                              |
| `useRouter()`                                             | the router (`Router`), subscribed — reading `activeRoute`/`path` re-renders on navigation                  |
| `useRouteContext(name)`                                   | what the named route's scope provides, typed off the routes table; accepts only scope-carrying route names |

### History & scroll

| Export                                                                            | Purpose                                                                                                                                                                              |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `createBrowserHistory()`                                                          | DOM history (default)                                                                                                                                                                |
| `createMemoryHistory({ url })`                                                    | server / tests — a real entry stack, so back/forward work without a DOM                                                                                                              |
| `History`, `HistoryLocation`, `HistoryListener`, `HistoryUpdate`, `HistoryAction` | the history contract, for custom hosts                                                                                                                                               |
| `history.go(delta)`, `.back()`, `.forward()`                                      | traverse the entry stack. Lands on an existing entry, so its `state` and `key` come back as they were, and the update arrives as `POP`. Out of range does nothing (it doesn't clamp) |
| `history.dispose?.()`                                                             | detach from the host (the browser history's `popstate`) and drop listeners. A history you inject is yours to dispose — the router only disposes one it created itself                |

A traversal reports back at different times on the two histories: the memory history owns its stack and emits before `go` returns, while the browser queues the traversal and the `POP` arrives on a later task (via `popstate`). Code that must work on both awaits the listener rather than reading `location` on the next line. | `installScrollRestoration(options?)` | standalone installer; usually configured via `RouterOptions.scrollRestoration` |

### `lazy(loader)`

`React.lazy` plus `.preload()`, so the router (and `<Link prefetch>`) can fetch a chunk before rendering — whether the component is mounted bare or folded into a route. Type: `PreloadableLazyComponent`.

It also carries a `.moduleId` — which module it imports, as the client manifest keys it. You never write it: §rati/vite's transform appends it as a second argument at each call site, so a server render can name the route's chunk (`prepareRoute` surfaces it; `renderApp` turns it into a `modulepreload`). Without the plugin it is absent, and `lazy` behaves exactly as it always did.

### Route types

`NameToRoute` (typed `to` objects), `ExtractRouteParams<Path>`, `GenericRouteType`, `RouteContextValueOf<Name>`, `RouteContextNames`, `RatiUserTypes` (the augmentation interface).

---

## Stores

rati ships **no stores container** — an app's store layer is app code (a plain class whose fields are your stores, behind your own React context and `useStores` hook), and the router is provided on its own (`RouterProvider`, see Routing). A container that wants the router holds the `Router` type: it is typed off the `RatiUserTypes` augmentation, so holding it never imports the route table — which is exactly what keeps the classic cycle (stores → routes → components → stores) from forming. Read the container anywhere, including inside scope loads via `hook(() => useStores())`.

---

## Head

Document metadata that needs **dedupe by depth** — the title and per-page meta. The deepest live declaration per slot wins (a page beats a layout default); on the client `HeadProvider` syncs `document.title` and the managed `<meta>` tags on hydration and every navigation; on the server the winners are read after prerender (`headTags` in `rati/ssr`, done for you by `renderApp`). Tags that don't need dedupe use native React 19 hoisting or the HTML shell — see the server rendering guide (ssr.md §Titles and meta).

| Export                                                                  | Purpose                                                                                                  |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `createHeadStore(options?)`                                             | one store per rendered tree (per request on the server); options: `defaultTitle`, `titleTemplate(title)` |
| `<HeadProvider store?>`                                                 | provides the store + owns the client document sync; `store` may be omitted in a client-only app          |
| `<Title>{string}</Title>`                                               | declare the document title (template applies)                                                            |
| `useTitle(title)`                                                       | hook form; `null`/`undefined` declares nothing                                                           |
| `<Meta name="…" content>` / `<Meta property="…" content>`               | declare a deduped meta tag (standard / Open Graph)                                                       |
| `HeadStore`, `HeadSnapshot`, `MetaTag`, `MetaProps`, `HeadStoreOptions` | the types; `store.snapshot(mode)` exposes the winners for custom sinks                                   |

---

## `rati/ssr`

The server-facing surface. (`HydrationProvider` and `readHydration` run on the client — mount the provider on both sides so the trees match.) The full flow with code: server rendering guide (ssr.md).

| Export                                                                                                                                             | Purpose                                                                                                                                                                                                                                                                                     |
| -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `renderApp({ url, createApp, assets?, onError? })`                                                                                                 | the whole per-request loop: memory history → `createApp` → `prepareRoute` → prerender → dispose. Returns `{ kind: 'rendered', html, status, headTags, stateScript, hydration, errors, matchedCatchAll }` \| `{ kind: 'redirect', to, permanent, status }` \| `{ kind: 'no-match', status }` |
| `RenderAssets`                                                                                                                                     | `{ bootstrapModules?, styleTags?, preloadTagsFor? }` — what the built client needs from the page. Normally `virtual:rati/assets` from §rati/vite; `bootstrapModules` reaches the prerender, the rest joins `headTags`                                                                       |
| `renderToHtml(node, { bootstrapModules?, onError? })`                                                                                              | drain `react-dom/static` `prerender` to a string (it awaits Suspense; `renderToString` cannot)                                                                                                                                                                                              |
| `serializeHydration(state)`                                                                                                                        | the payload as an inert `application/json` script tag (CSP-friendly, placement-free); warns outside production about values that don't survive JSON                                                                                                                                         |
| `readHydration()`                                                                                                                                  | client: parse the embedded payload; `null` → resolve from scratch                                                                                                                                                                                                                           |
| `headTags(store)`                                                                                                                                  | the head store's winners as escaped HTML — call after prerender                                                                                                                                                                                                                             |
| `prepareRoute(router)`                                                                                                                             | drive a memory-history router to its match (preloading a lazy component); returns `{ hydratedState, matchedCatchAll, redirect?, moduleId? }` or `null` when nothing matched                                                                                                                 |
| `createHydrationCollector()`                                                                                                                       | `{ collect, collectError, data, seeds, errors, dehydratedErrors }` — records islands' resolved values, live-source seeds, and failed loads during prerender                                                                                                                                 |
| `HydrationProvider`                                                                                                                                | server: `collect`/`collectError`; client: `data`/`seeds`/`errors` — islands then hydrate without re-running loads                                                                                                                                                                           |
| `HydrationState`, `HydrationError`, `Hydration`, `HydrationData`, `HydrationErrors`, `PreparedRoute`, `RouterHydratedState`, `HYDRATION_SCRIPT_ID` | the payload/decision types                                                                                                                                                                                                                                                                  |

Async load results and `ssr: true` sources dehydrate as values; `ssr: { hydrate }` sources dehydrate as seeds; unmarked sources stay pending under SSR and come alive after hydration (see Sources §SSR-capable sources — §SSR-capable sources — the ssr marker).

A load that *rejects* is recorded in `errors` — statuses derive from it (`not-available` → 404); the HTML degrades to the loading slot and the client retries the load after hydration, unless the island set `ssrErrors: 'dehydrate'` (§ssrErrors — the error slot in the server's HTML), in which case the failure also lands in `dehydratedErrors` (the payload's third section) and the client hydrates onto the error slot instead. `errors` is the flat list either way — it never leaves the server, and it is what the status derives from.

---

## `rati/vite`

Optional — requires the `vite` peer dependency. Build-time only: it runs in the Vite process and nothing from this entry reaches the browser. Walkthrough: server rendering guide (ssr.md §The Vite plugin).

| Export                                                                 | Purpose                                                                                                                                                                                                                                                                                     |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ratiSsr({ entry?, clientEntry?, template?, placeholders?, outDir? })` | dev: render every request through the app's server entry inside Vite's own dev server — result kinds mapped onto the response, `transformIndexHtml` on the shell (so HMR lives), failures in Vite's error overlay. build: both environments on one `vite build`, plus `virtual:rati/assets` |
| `virtual:rati/assets` (generated)                                      | `{ bootstrapModules, styleTags, preloadTagsFor(moduleId) }` — the built client's tags, inlined into the server bundle so production reads no manifest. Hand it to `renderApp` as `assets`. Types: `/// <reference types="rati/vite/client" />`                                              |

`entry` defaults to `/src/entry-server.tsx`, `clientEntry` to `/src/entry-client.tsx` (the client build's input — so `index.html` is a shell, not a build input), `template` to `index.html` (Vite-root relative), `placeholders` to `{ head: '<!--app-head-->', html: '<!--app-html-->', state: '<!--app-state-->' }`, `outDir` to `{ client: 'dist/client', server: 'dist/server' }`. A `render` returning a whole `<html>` document is spliced into rather than filled — no option to set. Anything the app renders with nowhere to go throws rather than serving a page that silently lost it.

A `lazy()` route's client chunk is preloaded in the page it is rendered on: the plugin transforms each `lazy()` call site to record the module it imports, and resolves it through the client manifest. It is additive metadata — `lazy()` behaves identically without the plugin.

---

## `rati/server`

Production only — dev is the plugin (§rati/vite)'s job, so there is no branch in here. Walkthrough: server rendering guide (ssr.md §The production handler).

Nothing in here imports React — `react` is an optional peer, so a server-only workspace can install rati for `createRequestHandler` alone and never add it.

| Export                                                                          | Purpose                                                                                                                                                                                            |
| ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `createRequestHandler({ render, template?, assets?, placeholders?, onError? })` | → `(request: Request) => Promise<Response>`. The result kinds as HTTP: 30x with `Location`, the rendered page at its derived status, 404 for `no-match`, and a 500 CSR fallback if `render` throws |
| `serve({ handler, staticDir?, port? })`                                         | → `Promise<Server>`. A `node:http` listener for the handler, with minimal static serving. Dependency-free                                                                                          |

`render` is the server entry's (the Layer-1 contract — §rati/ssr). `template` is your HTML shell as a string — a whole-document app needs none. `placeholders` must match `ratiSsr({ placeholders })`. `onError` defaults to `console.error`.

`assets` is the same `virtual:rati/assets` you pass `renderApp` — **re-export it from the server entry** to reach it here, since the virtual module exists only inside the build. It is used for one thing: if `render` throws (an error outside every island — a failing *load* is caught by its island and carried in the status), the handler serves the shell with the assets tags, an empty root and no payload, at status 500. The client entry finds no payload, calls `createRoot`, and resolves from scratch. A whole-document app has no template to fill, so the assets are synthesized into a minimal document instead — the unset `template` is the signal. Without `assets` the answer is a plain-text 500.

Fetch is the only interface: `app.all('*', (c) => handler(c.req.raw))` for Hono, `export default { fetch: handler }` for Vercel/Bun/Deno/workers. `serve()` is for the one host that isn't fetch-shaped; it maps `staticDir` files onto their URL paths with correct MIME types and sends everything else to the handler, so an unknown path reaches your app's 404 page. `port` defaults to `$PORT`, then 3000. No compression, caching or clustering — put a CDN in front for real traffic.

---

## `rati/mobx`

Optional — requires the `mobx` peer dependency; apps that never import this entry keep MobX out of their bundle.

| Export                                          | Purpose                                                                                                                                         |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `observableSource(getState, attach?, { ssr }?)` | adapt a MobX derivation to a `Source` — the bridge between MobX state and scope loads; `ssr` forwards the §SSR-capable sources — the ssr marker |

The MobX-shaped data primitives (`query`, `collection`, `mutation`, `form`) live in the §rati/data entry, which builds on this bridge. (The former legacy exports — `ActiveData`, `remoteData`, `remoteDataKey`, `responseKey` — are gone; `rati/data` is their successor.)

---

## `rati/data`

**Experimental.** Optional — requires the `mobx` peer dependency, like §rati/mobx (whose `observableSource` it builds on). The successor of the legacy data layer and of app-side `FetchStore` families; design record: `docs/archive/directions-2026-07/data-package.md`. The surface may still move; it is intended to eventually extract into a companion package.

Data in an app has four moments; each primitive owns exactly one, plus one for fetch topology and one for row identity:

| Export                                                             | Purpose                                                                                                                                                                                 |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `query(producer, { debounce?, reactive? }?)`                       | read one value: one async producer (`(signal: AbortSignal) => Promise<T>`), honest phases (`idle → loading → ready / refreshing / error`), race-guarded; `set`/`patch` write it locally |
| `collection({ fetch, key, equals?, into?, debounce?, reactive? })` | read a keyed set: one flat surface over the fetch (`items`, `phase`, `error`, `isPending`, `prime`, `refresh`, `reset`) plus identity-stable `patchItem`/`upsert`/`insert`/`remove`     |
| `reconciled(rows, { key, equals?, into? })`                        | the identity story alone, over rows you already have (the list half of a composite response) — no fetch, no phase                                                                       |
| `pagedCollection({ fetchPage, key, equals?, into?, reactive? })`   | read in pages: pages *are* queries (per-page phase/error/retry), structural `hasMore`, cursor re-anchoring `refresh()`                                                                  |
| `mutation(perform, { optimistic?, refreshes?, onError? }?)`        | write: callable with observable `isPending`/`error`, optimistic patch + refresh choreography                                                                                            |
| `form(fields)`, `field(initial, { validate?, equals? }?)`          | stage local edits: per-field baseline (`isDirty`/`reset()`/`commit()`), validate-on-submit, RAC-shaped `props`, a `submit()` that never rejects                                         |
| `required`, `minLength`, `maxLength`, `min`, `max`, `pattern`      | the validator kit — a validator is just `(value: T) => string \| undefined`; all but `required` skip empty values                                                                       |
| `FormError`                                                        | thrown by a submit handler to distribute `fieldErrors` onto matching fields (the API layer decides where a 422 becomes one)                                                             |

Instance-owned data: each primitive is an object living in your store graph; sharing happens by sharing the instance — no keyed cache, no normalized store. Everything that fails normalizes to `SourceError` (§Sources), so one `code` switch works from island error slots to in-content badges.

Not sure which one a given piece of data is? This entry documents each primitive; the guide's choosing a shape (guide.md §Choosing a shape) makes the calls between them — composite payload vs list, store-owned vs per-mount, a bounded map vs a selection.

**The scope seam.** Read-side primitives expose `source()`: pending until the first ready, then ready forever with **the instance itself** as the resolved prop — later refreshes and refresh errors are the instance's own observable state and never re-trip the island. `attach()` triggers `prime()` (ensure semantics); detach does nothing — the store owns the data's lifetime.

`query.source()` is typed `Source<ReadyQuery<T>>`, where `ReadyQuery<T> = Query<T> & { readonly data: T }` — the resolved prop's `data` is `T`, not `T | undefined`, so a component never writes `props.row.data!` or `?? fallback` for a value whose presence is *why* it rendered. The claim is honest by construction: the source goes ready only once the query holds a value, and `reset()` drops it back to `pending`, re-tripping the island. It is a read-side claim only — `refresh()`, `set()`, `patch()` and `reset()` all still take a `ReadyQuery`, which is the same live instance.

`collection.source()` and `pagedCollection.source()` need no equivalent: their `items` is `readonly Item[]` in every phase (empty before the first fetch), so there is nothing to strip.

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
    <List items={spaces.items} dimmed={spaces.phase === 'refreshing'} />
));
```

`optimistic` and `refreshes` both receive the call's own arguments, so a dependent keyed by the call is declarable — `refreshes: (spaceId) => [this.membersFor(spaceId)]` — and the `onError: 'refresh'` recovery reaches it too.

Division of labor: the island covers loading/error for the **first** resolution; the primitives' phases drive everything after — `refreshing` for stale display, per-page phases for pagination rows, `isSubmitting` for buttons. `query.prime()` is idempotent *ensure* (fetches from `idle`/`error`, no-ops when `ready`, dedupes in flight); `refresh()` is the only re-fetch and keeps stale data visible, even through a refresh failure. Under SSR the primitives stay pending (a `Source` attaches in effects) — this entry is for the interactive app, not the SSR path.

**`prime()` vs the scope's `.load({…})`** — same word, two surfaces, and only one of them is here. A scope's §.load(level) declares a waterfall level and is the framework's resolution machinery; a data primitive's `prime()` is the *ensure* on one instance: fetch if there is nothing (or an error), otherwise do nothing. Wiring `prime()` to a user gesture ("Reload") is the classic mistake — an already-ready query no-ops. Gestures call `refresh()`.

**`collection` is one flat surface.** Fetch state and item state sit side by side on the instance — `items`, `phase`, `error`, `isPending`, `prime()`, `refresh()`, `reset()`, and the keyed ops (`getByKey`, `patchItem`, `upsert`, `insert`, `remove`), plus `source()`. There is no backing query to reach through and no raw pre-reconcile array: `items` *is* the value surface, so nothing has to be asked "is this on the collection or the query?".

**`reconciled` — the composite-response answer.** A `collection` assumes the response *is* the array. When it isn't — `{ usefulData: string; spaces: SpaceRow[] }` — the fetch is a plain `query`, and `reconciled(rows, { key })` gives its list half the same identity-stable reconciliation, over any observable rows:

```ts
class SpaceOverviewStore {
    // Declaration order matters (see below): the query, then the view over it.
    overview = query((signal) => fetchOverview(this.spaceId, signal));
    spaces = reconciled(() => this.overview.data?.spaces ?? [], { key: (s) => s.id });

    get usefulData() {
        return this.overview.data?.usefulData;
    }
}
```

One fetch, one payload; `usefulData` is read straight off the query, and `spaces.items` keeps its item instances across every `overview.refresh()`. The view has **no fetch, no phase, no error and no `source()`** — the backing query owns all of those, and it is the query a scope loads and a mutation's `refreshes` lists.

What the view exposes is exactly the identity half: `items`, `getByKey`, `patchItem`, `upsert`, `insert`, `remove` — the same contract as inside a collection, including the patch marking that lets the next reconcile restore server truth. `collection` is now literally this composition, pre-wired. (Which of the two a response wants: choosing a shape (guide.md §Choosing a shape).)

Two things follow from the derivation being **eager** (a MobX reaction established at construction, re-reconciling whenever the getter's output changes — precisely when a collection reconciled before):

- the rows getter runs **once immediately**, so in a class the backing query must be declared *above* the view; a field initializer reading a not-yet-assigned field throws at construction;
- the view holds its subscription for its lifetime. `dispose()` releases it — needed only when a view outlives the store that owns it.

**Single-value writes.** `query` mirrors the collection's write seam for its one value: `set(next)` replaces it locally (the server-push case, `upsert`'s sibling) and `patch((current) => next)` is the optimistic edit (`patchItem`'s sibling — a `mutation`'s `optimistic:` callback writes through it).

Both swap the `data` reference (**return a new object** — an in-place edit of a plain payload is invisible), touch no fetch and no standing error, and lose to any later settle: a refresh overwrites wholesale, which is exactly what makes `onError: 'refresh'` recovery work with no dirty-mark. `patch` no-ops before the first value; under a `reconciled` view, a local write to the query reconciles the items like a fetch would.

**Reactive params** (`reactive: true`, opt-in). A `query` marked `reactive` re-fetches when the observables its producer reads **synchronously** change — the type-ahead / filter case, replacing a store's manual `prime()`-after-every-setter. The re-run is a `refresh()`, so `debounce` coalesces the burst; `collection` forwards both options to its query.

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

The tracked window is the producer's **synchronous prefix only** — reads after the first `await` are outside MobX's tracking, so destructure every reactive dependency at the top. `pagedCollection`'s `reactive` is *reset*, not refresh: a tracked param change invalidates every cursor, so the list resets to the first page (the island drops to its loading slot). The rule for choosing between this and the scope's selective refresh (§useScopeControls(scope)): a value in the URL belongs to the scope (a route-param change re-resolves); a value in a store observable belongs to the reactive query.

Forms never touch the island: they are synchronous local state seeded from data the island already resolved — `form({ title: field(space.title, { validate: required() }) })` is the draft; `submit(handler)` validates, runs the handler (typically awaiting mutations), commits on success, distributes a thrown `FormError` onto fields, and lands anything else on `form.error`. The returned function never rejects: a call site never has to catch, and `isSubmitting` is the whole pending story.

That shape is action-compatible — but **don't wire it as a function `action=`** when the inputs are controlled by the fields. React resets a form once an action settles, and since a failed submit still *completes* the action, the reset erases the draft on exactly the submits the user needs to correct. Wire it through `onSubmit` + `preventDefault` instead; the guide's with React Aria Components (guide.md §With React Aria Components) has the mechanism and the wrapper to put it in.

### `keyed` — one instance per id

`keyed(factory)` is the lazy per-key instance map every keyed resource otherwise hand-rolls (`Map<id, instance>` plus get-or-create). It is deliberately thin and **primitive-agnostic**: the factory returns whatever you build — a `query` of a composite payload, a `collection`, a `pagedCollection`, or a store class stitching several — and `keyed` never calls into it.

| Member        | Purpose                                                                                                                                                                                                    |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `get(key)`    | get-or-create: the first call for a key runs the factory, every later one returns **that same instance** — per-key identity is the contract                                                                |
| `peek(key)`   | the instance if one exists, `undefined` otherwise; never creates. Reactive: a derivation that peeked a missing key re-runs once `get` creates it                                                           |
| `delete(key)` | drop one instance — the caller knowing the key is spent (a closed detail view, a deleted entity). Returns whether it was present; the next `get` builds fresh. Same contract as `reset`, one key at a time |
| `reset()`     | drop every instance (the sign-out case). It does *not* call into them — dropping the references *is* the semantics; a caller still holding one resets it itself                                            |

Keys are `string | number` (they are `Map` keys, so identity is `===`); a branded id type is a `string` and passes.

```ts
class SpacesStore {
    // A composite payload per space: the query is the unit, `keyed` holds one per id.
    // (A list inside such a payload wants a `reconciled` view beside the query — see
    // above; the store-class shape below is where that pair usually lives.)
    overview = keyed((spaceId: SpaceId) =>
        query(async (signal) => ({
            space: await fetchSpace(spaceId, signal),
            members: await fetchMembers(spaceId, signal),
        })),
    );

    // …or a collection per space, when the keyed resource *is* a list.
    members = keyed((spaceId: SpaceId) =>
        collection({
            fetch: (signal) => fetchMembers(spaceId, signal),
            key: (member) => member.userId,
        }),
    );
}
```

A store class per key is the shape to reach for once a space owns more than one resource — the instance is an ordinary store, so it holds mutations, derived state and UI state alongside its data:

```ts
class SpaceStore {
    constructor(readonly spaceId: SpaceId) {}

    members = collection({
        fetch: (signal) => fetchMembers(this.spaceId, signal),
        key: (member) => member.userId,
    });
    jobs = pagedCollection({
        fetchPage: (cursor, signal) => fetchJobs(this.spaceId, cursor, signal),
        key: (job) => job.jobId,
    });
}

class SpacesStore {
    byId = keyed((spaceId: SpaceId) => new SpaceStore(spaceId));

    invite = mutation(inviteRequest, {
        // The call's own arguments name the instance it invalidated.
        refreshes: (spaceId: SpaceId) => [this.byId.get(spaceId).members],
    });
}
```

That last line is the point of stable per-key identity: `refreshes` receives the call's arguments, so `get(spaceId)` reaches exactly the instance the mutation touched — and under the default `onError: 'refresh'`, the recovery reaches it too. Scopes read the same way, keyed by a route param:

```ts
export const spaceScope = scope({ spaceId: input<SpaceId>() })
    .load({ stores: hook(() => useStores()) })
    .load({ space: ({ spaceId, stores }) => stores.spaces.byId.get(spaceId) })
    .load({ members: ({ space }) => space.members.source() });
```

**A map, not a cache.** No eviction, no TTL, no LRU, and no cross-key identity: two keys whose payloads mention the same entity hold two independent instances. An *unbounded* key space (a search result's every row) wants a **selection** — one instance whose parameters change, via `reactive: true` or a scope input — not a map that grows for the lifetime of the tab (choosing a shape — guide.md §Choosing a shape draws the bounded / unbounded line).

The middle case — per-key instances the *caller* retires, like a detail dialog per id closed behind the user — is still a map: `delete(key)` on close is the caller knowing the key is spent, not a cache policy. And because `get` creates, call it from an action, an event handler or a scope load, never from inside a `computed`, which may not cause side effects; `peek` is the read-side twin for those.

---

## `rati/debug`

Two console tracers for the two halves of a page appearing: getting *there* and getting the *data*. Both are off by default and cost one flag read when off, so their marks live permanently on those paths; toggle either live from the console.

| Export                                         | Purpose                                                                                                   |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `navTrace`, `navTraceStart`, `navTraceEnabled` | navigation-timeline tracing; toggled live via `globalThis.__DEBUG__.nav`, near-zero cost when off         |
| `dataTrace`, `dataTraceEnabled`                | data-resolution tracing per island; toggled live via `globalThis.__DEBUG__.data`, near-zero cost when off |

### `dataTrace`

`window.__DEBUG__ = { data: true }` and every island logs its resolution: one line per level start, one per cell settle (`ready` / `error` / back to `pending`), one per `refresh`, and one when the component finally renders.

```
[data] Route(Prefs) +0.0ms level 0 start (initial) [userId]
[data] Route(Prefs) +0.2ms level 1 start [user,prefs]
[data] Route(Prefs) +0.3ms (Δ0.1ms) level 1 prefs ready
[data] Route(Prefs) +12.4ms (Δ12.2ms) level 1 user ready
[data] Route(Prefs) +12.6ms level 2 start [tree]
[data] Route(Prefs) +41.0ms (Δ28.4ms) level 2 tree error not-available — gone
[data] Route(Prefs) +41.2ms (Δ41.2ms) resolved — component renders
```

- The line's prefix is the island's own name (`Island(…)` / `Route(…)`) — several resolve concurrently into one console.
- `+` is since **this island's run** started; `Δ` is since **that cell's** own mark. So `+` on the last line is what the waterfall cost end to end, and `Δ` on a settle is what that one load cost.
- A run is one resolution generation, and its first line says why it exists: `(initial)`, `(inputs)` — an input changed — or `(retry)`.
- Level 0 is the scope's inputs head; the `.load()` levels follow. Inputs arrive with the run, so they get no settle line; a value the server resolved is marked `(hydrated)`.
- A cell is logged when it *transitions*, not when it is read — a live source that keeps producing values stays quiet until it drops back to `pending` or errors.

`dataTrace(label)` adds your own line to the same log (inside a load, say); `dataTraceEnabled()` guards work you only want to do while tracing.

---

## `rati/testing`

Test-environment only — everything here calls React's `act` (imported from `react`, not `@testing-library/react`, which this entry does *not* depend on). Each helper scopes `IS_REACT_ACT_ENVIRONMENT` around its own `act` calls and restores it after (the RTL pattern), so the entry works even in a suite that deliberately leaves the global unset — and never changes your runner's policy. Your own bare `act(…)` drives still need a runner environment: `@testing-library/react` sets one up on import, or set `globalThis.IS_REACT_ACT_ENVIRONMENT = true`. These are the primitives rati's own suites (and Jnana's) hand-rolled before this entry existed.

Using a `rati/*` entry for the first time in a Vitest **browser**-mode project? Add it to that config's `optimizeDeps.include`. An un-prebundled entry triggers a mid-run re-optimization ("new dependencies optimized … reloading"), which surfaces as failing tests deep inside React — a component crash in the report, a bundling event in reality.

| Export                               | Purpose                                                                                                                                                                                                                                                  |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `deferred<T>()`                      | `{ promise, resolve, reject }` — a promise you settle by hand, to walk a load through its phases. `T = void` → no-arg `resolve()`                                                                                                                        |
| `flush(times?)`                      | `await` `times` empty `act`-flushed microtask turns (default 1). A Suspense retry after a settle isn't synchronous with the resolving `act`, and a waterfall re-suspending one level deeper needs one flush per level — prefer a fixed count over a poll |
| `controllableSource<T>(options?)`    | a real `Source<T>` you drive by hand, with an attach/detach ledger                                                                                                                                                                                       |
| `renderIsland(target, options?)`     | mount an island (or `{ scope, component, … }` config) and drive it; async, returns a handle. See below                                                                                                                                                   |
| `createTestRouter(routes, options?)` | memory history + router + provider, rendered and disposed for you; async, returns a handle. See below                                                                                                                                                    |
| `prerenderToString(node, options?)`  | drain `react-dom/static` `prerender` to an HTML string (it awaits Suspense; `renderToString` cannot). See below                                                                                                                                          |
| `ssrRender(node, options?)`          | a collected server render — HTML + dehydrated payload, plus `.hydrate()` for the client half. The SSR round-trip. See below                                                                                                                              |
| `cleanup()`                          | unmount every tree the harness mounted (islands, routers, hydrated round-trips) — wire up `afterEach(cleanup)`                                                                                                                                           |

`controllableSource` is a genuine source — an island attaches it, subscribes, and re-renders on every transition. Its mutators are **raw**: they set state and notify synchronously, *without* wrapping `act` (a source is also driven from inside engine flow — a `queueMicrotask` in a load — where a nested `act` would misbehave). Wrap a top-level drive in `act` yourself, or follow it with `await flush()`.

| Member                                                      | Purpose                                                                                                                                                                                   |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `setReady(value)`                                           | → `ready` (a fresh snapshot each call, so uSES re-renders). Repeatable                                                                                                                    |
| `setPending()`                                              | → `pending`. Repeatable — pair with `setReady` to bounce a live source                                                                                                                    |
| `setError(error)`                                           | → `error`; a bare string is taken as the `SourceError` `code`                                                                                                                             |
| `emit()`                                                    | re-emit the last ready value with a *stable* value identity — a live source ticking/recovering without a value change (downstream loads don't re-run). Throws before the first `setReady` |
| `attachCount` / `detachCount` / `attached` / `peakAttached` | the ledger: totals, whether it's live now (`false` after teardown = no leak), and the concurrent peak (`> 1` for one instance is a double-attach)                                         |

Options: `initial` (start `ready` with a value instead of `pending`), `ssr` (the `SourceSSR` marker — passed straight through), `loads` (the loader shape: on `attach`, if still pending, settle `ready` to this value on a microtask — pair with `ssr: true`), `seed` (the seedable-live-source shape: `{ dehydrate?, hydrate }` where `hydrate` decodes the wire value and *returns* the seeded value — the source is `ready` before `attach`; throw from it to model a store rejecting a stale seed; combines with `loads` for "load on attach unless already seeded"; mutually exclusive with `ssr`), `onAttach` / `onDetach` (run at the ledger edges, for asserting attach ordering).

### `rati/testing/data`

The same hand-drive idea for the §rati/data primitives, in its own subpath because it imports MobX — an app that never touches `rati/data` keeps the optional peer uninstalled and still gets everything above.

| Export                             | Purpose                                                                                                                                                              |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `controllableProducer<T, Args?>()` | a producer whose every call the test settles, with the call ledger: `producer`, `calls`, `callCount`, `lastCall`, `pendingCall`, `resolve(value)`, `reject(reason?)` |
| `controllableQuery<T>(options?)`   | a **real** `query` pre-wired to one — the query's whole surface plus the settle controls on a single object. `options` are `QueryOptions` (`debounce`, `reactive`)   |

`controllableProducer` replaces the three lines every data suite wrote by hand — a `deferred` array, a call counter, and a closure indexing into them — and adds what that version kept leaving out: which call is which, whether it settled, and each call's own `AbortSignal`. Hand `producer` to a `query`, a `collection`'s `fetch`, or a `pagedCollection`'s `fetchPage`; the trailing parameter is always the signal rati passes, and `Args` names whatever precedes it (`controllableProducer<PageResult<Row, string>, [string | null]>()` for a `fetchPage`, whose `lastCall.args` is then the cursor).

| Member                               | Purpose                                                                                                                                 |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| `producer`                           | `(...args, signal) => Promise<T>` — the thing under test calls it                                                                       |
| `calls`                              | every call so far, oldest first; live, and each carries `index`, `args`, `signal`, `promise`, `settled`, `aborted`, `resolve`, `reject` |
| `callCount`                          | `calls.length` — "did it re-fetch?" in one assertion                                                                                    |
| `lastCall` / `pendingCall`           | the most recent call, and the oldest un-settled one. Both throw with a diagnostic when there is no such call                            |
| `resolve(value)` / `reject(reason?)` | settle `pendingCall` — so calls settle in order unless you address one directly (`calls[1].resolve(…)`)                                 |

`controllableQuery` is not a wrapper: the controls are defined onto the real query instance, so `q.source()` still resolves with `q` itself — the identity an island receives. Settles are **raw**, like `controllableSource`'s mutators: awaiting the `prime()` / `refresh()` promise is the settle point, and a React test wraps the drive in `act` or follows it with `await flush()`.

```ts
import { controllableQuery } from 'rati/testing/data';

test('a refresh failure keeps the stale rows on screen', async () => {
    const q = controllableQuery<Row[]>();

    const loading = q.prime();
    expect(q.phase).toBe('loading');
    q.resolve([{ id: 'a', title: 'Alpha' }]);
    await loading;

    const failing = q.refresh();
    q.reject(new Error('offline'));
    await failing;

    expect(q.phase).toBe('error');
    expect(q.data).toHaveLength(1);              // …still visible, beside the error
    expect(q.error).toMatchObject({ code: 'failed' });
});
```

A store test uses the low-level piece, because the store builds its own primitives — you inject the producer, not the query:

```ts
import { controllableProducer } from 'rati/testing/data';

class SettingsStore {
    constructor(fetchSettings: (signal: AbortSignal) => Promise<Settings>) {
        this.settings = query(fetchSettings);
    }
    get retentionDays() { return this.settings.data?.retentionDays ?? 30; }
}

test('a failed refresh keeps the last good settings', async () => {
    const server = controllableProducer<Settings>();
    const store = new SettingsStore(server.producer);

    const loading = store.settings.prime();
    server.resolve({ retentionDays: 7 });
    await loading;
    expect(store.retentionDays).toBe(7);

    const failing = store.settings.refresh();
    server.reject(new Error('offline'));
    await failing;
    expect(store.retentionDays).toBe(7);         // stale-but-good, not the default
    expect(server.callCount).toBe(2);
});
```

Three patterns worth naming, all of which real suites needed:

- **Abort on supersede** — `server.calls[0].aborted` after a `reset()` or a reactive invalidation, with no `let signal` capture.
- **Out-of-order settles** — address the call: `server.calls[1].resolve('new')` before `server.calls[0].resolve('old')` pins that a superseded settle is ignored.
- **The debounced path** — `vi.useFakeTimers()`, then `q.refresh()` twice, `expect(q.callCount).toBe(0)`, `await vi.advanceTimersByTimeAsync(waitMs)`, `expect(q.callCount).toBe(1)`: the coalescing is visible as calls that never happened. Reset with `vi.useRealTimers()` in `afterEach`.

One limit on `reactive: true`: a bare `controllableQuery` producer reads nothing observable, so there is nothing for the reaction to track. Put the tracked read in your own producer and use `controllableProducer` for the settle — `query((signal) => { const term = filter.term; return server.producer(signal); }, { reactive: true })`.

**`renderIsland(target, options?)`** mounts an island and hands back a handle for driving it. Pass a `{ scope, component, loading?, error? }` config (the full-featured path) or an already-built `island()` component; `options` takes `props` (the island's inputs — **required** when the scope declares required inputs, mirroring what JSX would demand) and a `wrapper` (app-level providers).

It renders with `react-dom/client` — no `@testing-library/react` dependency — and returns the container, so query it however you already do. It is **async**: the mount settles the scope as far as it can, so a self-settling load is already `content` while a still-pending one (a `deferred`, an un-driven `controllableSource`) reads as `loading`; drive it, then `await flush()`.

| Handle member      | Purpose                                                                                                                                                                                                                                                                          |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `container`        | the mounted DOM node (appended to `document.body`)                                                                                                                                                                                                                               |
| `slot()`           | which slot is on screen — `'loading'` / `'content'` / `'error'`; reads visibility, so a Suspense-hidden stale subtree doesn't count as content. Throws when no marker is in the DOM at all (the island unmounted, or threw past its slots to an ErrorBoundary). Config mode only |
| `text()`           | the visible slot's trimmed `textContent`. Config mode only                                                                                                                                                                                                                       |
| `controls()`       | the island's `useScopeControls` (imperative `refresh` + the live `pending` set), from the test side. Config mode only                                                                                                                                                            |
| `rerender(props?)` | re-render with new inputs — the param-change path. `props` is required when the scope has required inputs (no silent input wipe). Async, like the mount                                                                                                                          |
| `unmount()`        | unmount and remove the container                                                                                                                                                                                                                                                 |

Config mode wraps each slot in a private marker element to read `slot()` — testids never enter the island's own API. A pre-built island exposes neither its scope nor its slots, so `slot()` / `text()` / `controls()` need the config form. One limit: the async mount skips StrictMode's mount/unmount/remount, so a test pinning that discard-the-first-run behavior must render synchronously instead.

```ts
import { renderIsland, deferred, controllableSource, flush, cleanup } from 'rati/testing';

afterEach(cleanup);

test('loading → content', async () => {
    const gate = deferred<string>();
    const handle = await renderIsland(
        {
            scope: scope({ id: input<string>() }).load({ page: () => gate.promise }),
            component: ({ page }) => <div>ready {page}</div>,
            loading: () => <div>loading…</div>,
        },
        { props: { id: 'a1' } },
    );

    expect(handle.slot()).toBe('loading');   // the deferred load is still pending
    gate.resolve('home');
    await flush();                            // let the Suspense retry land
    expect(handle.slot()).toBe('content');
    expect(handle.text()).toBe('ready home');
});
```

**`createTestRouter(routes, options?)`** wires a **memory** history + a router + `RouterProvider` and renders it — replacing the `createMemoryHistory` / `createRouter` / provider / `<RouterOutlet>` boilerplate. `options`: `url` (initial URL, default `/`), `state` (initial entry state), `ui` (what to render — defaults to `<RouterOutlet />`; pass a custom tree, or `<RouterOutlet Loading={…} />`), `wrapper` (your app's own provider — stores/DI context — rendered inside the router context around `ui`), `basename` (mount the table under a prefix), `hydratedState` (seed the router from a dehydrated navigation — the SSR client path).

Because a real router is mounted, **`<Link>` works with no `vi.mock`**. Scroll restoration is off (jsdom has no layout), and `cleanup()` disposes the router — detaching its history.

| Handle member                                | Purpose                                                                                                                                                               |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `router` / `history`                         | the live router (the concrete store — internals reachable) and its memory `History` — navigate, read `path`/`activeRoute`, spy, or `push`/`go` directly               |
| `container` / `text()`                       | the mounted node and what it says — `text()` skips React's hidden subtrees, so a boundary's Suspense-hidden previous children don't read as a second copy of the page |
| `navigate(to)` / `back()` / `forward()`      | drive navigation, settled (async)                                                                                                                                     |
| `rerender(node)` / `unmount()` / `dispose()` | re-render, unmount; `dispose()` also disposes the router                                                                                                              |

```ts
import { createTestRouter, cleanup } from 'rati/testing';

afterEach(cleanup);

test('a Link navigates — no mocks', async () => {
    const tr = await createTestRouter([
        route('/', 'home', () => <Link href="/about">go</Link>),
        route('/about', 'about', () => <div>about page</div>),
    ]);
    tr.container.querySelector('a')!.click();
    await tr.navigate('/about');            // or let the click settle
    expect(tr.text()).toBe('about page');
});
```

### The SSR round-trip kit

Testing SSR means: drain `react-dom/static` `prerender` to a string, wire the hydration collector/provider, then `hydrateRoot` the output and assert the client didn't re-run its loads. This kit is that flow, so nobody hand-rolls the reader loop and the container juggling again. **jsdom-environment only** (where SSR tests run); no streaming (the engine's non-goal), and no whole-`document` hydration or HTTP-level rendering — `renderApp` and the §rati/server handler keep their own setups.

**`prerenderToString(node, options?)`** is the bare drain loop — `prerender` (not `renderToString`, which can't await Suspense) reduced to one HTML string, with every resolved boundary inline. `options`: `onError` (forwarded to `prerender` — pass `() => {}` to swallow an expected server-side throw), `progressiveChunkSize` (the outlining budget; defaults to never outlining), `settleTimeout` (below). Use it for a server-only assertion — a promise load resolving into the HTML, or a marked source staying pending with no collector to carry it.

**When a server render hangs**, `settleTimeout` (milliseconds, on either function) is the diagnostic: it fails the drain with *which* budget ran out, how many Suspense boundaries were still pending, and their component stack — instead of leaving your runner to report a generic "test timed out" some seconds later. The usual causes are a load whose promise never settles and an `ssr`-marked source nobody drove to ready (a `controllableSource({ ssr: true })` with no `loads`, say).

It is **off by default**: any budget rati picked would sit either above your runner's own timeout, doing nothing, or below a legitimately slow load, failing a good test. It arms a real `setTimeout`, so under fake timers it fires only when you advance them.

```ts
await ssrRender(<Page />, { settleTimeout: 1000 });
// Error: The server render did not settle within its 1000ms `settleTimeout` — 1 Suspense
// boundary was still pending when the budget ran out. […] Still pending at:
//     at Step (…/mandala/resolver.tsx)
```

**`ssrRender(node, options?)`** is the round-trip. It wraps `node` in a `HydrationProvider` carrying a fresh collector, drains the prerender, and returns the **server half** — the HTML plus the dehydrated payload — with a `.hydrate()` for the **client half**.

| `ssrRender` handle               | Purpose                                                                                                                                                                                                        |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `html`                           | the server-rendered HTML string (pre-hydration) — assert with `toContain`                                                                                                                                      |
| `data`                           | dehydrated resolved values (promise loads, `ssr: true` loaders): `mandalaId → key → value`                                                                                                                     |
| `seeds`                          | dehydrated live-source seeds (`ssr: { dehydrate, hydrate }`)                                                                                                                                                   |
| `errors`                         | loads that rejected during the render — the server's 404/5xx signal                                                                                                                                            |
| `dehydratedErrors`               | the payload's `errors` section: the failures `ssrErrors: 'dehydrate'` (§ssrErrors — the error slot in the server's HTML) islands carry to the client, which `.hydrate()` feeds back. Empty in the default mode |
| `hydrate(clientNode?, options?)` | hydrate the HTML on the client, feeding the payload back. See below                                                                                                                                            |

**`.hydrate(clientNode?, options?)`** pre-fills a container with the server HTML, wraps `clientNode` (defaulting to the server node) in a client-side `HydrationProvider`, and `hydrateRoot`s it. `clientNode` differs from the server node only when the trees must — a route round-trip renders the server under memory history and the client under browser history.

By default a **hydration mismatch fails the test loudly**: if React reports a recoverable error (it client-rendered over markup that didn't match — the signature of a load that re-ran and re-suspended its loading slot), `.hydrate()` throws, naming the mismatch. `options`: `allowMismatch` (collect those errors on `.recovered` instead of throwing — for deliberate-degradation tests, an SSR-error baseline whose loading slot the client re-renders through), `onDispose` (runs at unmount — dispose a client router here).

| `.hydrate()` handle            | Purpose                                                                                                  |
| ------------------------------ | -------------------------------------------------------------------------------------------------------- |
| `container`                    | the hydrated DOM node (appended to `document.body`)                                                      |
| `text()`                       | what the hydrated node says (hidden subtrees skipped, as above)                                          |
| `recovered`                    | React's recoverable hydration errors — empty on a clean round-trip; populated only under `allowMismatch` |
| `rerender(node)` / `unmount()` | re-render (a client update) / unmount and remove the container                                           |

Wire up `afterEach(cleanup)` — it unmounts hydrated round-trips too, running each `onDispose`.

```ts
import { ssrRender, cleanup } from 'rati/testing';

afterEach(cleanup);

test('the page hydrates without refetching', async () => {
    let fetches = 0;
    const Page = island({
        scope: scope().load({
            user: async () => { fetches++; return { name: 'Ada' }; },
        }),
        component: ({ user }) => <h1>{user.name}</h1>,
        loading: () => <p>loading</p>,
    });

    const server = await ssrRender(<Page />);
    expect(server.html).toContain('Ada');    // resolved server-side, in the HTML
    expect(fetches).toBe(1);

    const client = await server.hydrate();
    expect(client.text()).toContain('Ada');  // hydrated from the payload
    expect(fetches).toBe(1);                  // the load did NOT re-run
    expect(client.recovered).toEqual([]);     // …and a re-run's mismatch would have thrown
});
```

**Route-level round-trips are a documented composition**, not a helper — the kit owns the prerender→collect→hydrate mechanics; the router-SSR wiring stays yours to assemble (so the entry doesn't freeze it). Build a memory-history router for the server and a browser-history one for the client seeded from `prepareRoute` (§rati/ssr), and hand the two trees to `ssrRender` / `.hydrate`:

```ts
const serverRouter = createRouter(routes, { history: createMemoryHistory({ url }) });
const prepared = await prepareRoute(serverRouter);
const server = await ssrRender(
    <RouterProvider router={serverRouter}><RouterOutlet /></RouterProvider>,
);
serverRouter.dispose();

window.history.replaceState(null, '', url);
const clientRouter = createRouter(routes, {
    history: createBrowserHistory(),
    hydratedState: prepared!.hydratedState,
});
const client = await server.hydrate(
    <RouterProvider router={clientRouter}><RouterOutlet /></RouterProvider>,
    { onDispose: () => clientRouter.dispose() },
);
expect(client.recovered).toEqual([]);   // hydrated the route with no mismatch
```
