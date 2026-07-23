# rati — internals

Implementation notes for contributors. The public API lives in
[docs/public/](public/guide.md) (the guide + [reference](public/reference.md) — the
website's source of truth); future-facing explorations are in [research/](docs/research/).

## Source layout

```
src/
  mandala/   the core renderable unit (the shared engine under island & route)
    mandala.tsx     createMandala() + MandalaConfig / MandalaComponent
    resolver.tsx    the scope → Step-tree waterfall (Step, Leaf, ProvideLeaf, buildTree)
    refresh.ts      the cell model + RefreshController (selective refresh)
    controls.ts     the controls channel + useScopeControls
    channel.ts      the value channel + useScope / useOptionalScope / useScopeRead
    boundary.tsx    the error boundary
    hydration.tsx   SSR dehydration (values + live-source seeds + error recording)
    hydrationDiagnostics.ts  the client-side unclaimed-payload watchdog
    ssrSource.ts    firstSettle — the server-side promise face of SSR-marked sources
    ssrErrors.ts    the ssrErrors: 'dehydrate' guard (server-side, one per run)
    afterHydration.tsx  the ssr: false gate (server + hydration pass render the slot)
    loadingDelay.ts the loadingDelayMs gate (one window per island, client-only)
    retryPolicy.ts  the retry option's driver (one budget per island, client-only)
  island/    island.ts — public island() wrapper + Island* / Hydration* aliases
  head/      store.ts (HeadStore/createHeadStore), HeadProvider, Title/useTitle/Meta,
             useHeadTag (shared registration), domSync (client title/meta reconciler),
             context
  router/    route.tsx (route() + route/param/redirect types), store.ts (RouterStore),
             Router (keys the page per navigation — by route name for a kept run), Link,
             Navigate, useRouteContext, prepareRoute, history, scrollRestoration, lazy
  scope/     scope.ts (scope/input/load/provide/hook/data + scope types), source.ts
  ssr/       index.ts (the rati/ssr entry) + renderApp, renderToHtml, payload
             (serializeHydration/readHydration), headTags, html (template filling /
             whole-document splicing — shared by the two things that assemble, the
             plugin's dev middleware and rati/server's handler; not exported)
  server/    index.ts (the rati/server entry) + requestHandler (result kinds → fetch
             Response, incl. the CSR fallback), node (the node:http adapter: static
             files + the MIME table). Production only — dev is the plugin's
  vite/      index.ts (the rati/vite entry) + ratiSsr (the dev middleware + the
             two-environment build), assets (the virtual:rati/assets generator),
             lazyModules (the specifier-recording transform), client.d.ts (types for
             the generated module). Node-side, never bundled into an app; type-imports
             the RenderAppResult contract and nothing else
  data/      the rati/data entry: MobX-shaped data primitives (query, collection,
             mutation, form/field) — experimental, pending extraction to a
             companion package (docs/archive/directions-2026-07/data-package.md)
  testing/   the rati/testing entry: test utilities (deferred, flush,
             controllableSource, the island/router/stores render harnesses, and
             the SSR round-trip kit) — the generic cores promoted out of the
             suites' hand-rolls. Test-environment only; shipped for consumers
  debug/     index.ts — the rati/debug entry: the two opt-in console tracers
  stores/    RootStore, GlobalStore (store roots)
  util/      utils.ts, navTrace.ts (the navigation timeline), dataTrace.ts (island
             resolution: level starts, cell settles, refreshes) — both gated on a
             flag off globalThis.__DEBUG__, both re-exported by debug/
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
- **Cells** (the model lives in `refresh.ts`): one per data key —
  `value | promise | source` plus the refresh bookkeeping (read-set, `rerunnable`,
  `equals`, `dirty`, the `refreshing` token, the `lastValue` stale baseline). Function and
  class producers run against a read-tracking `Proxy` of the prior levels' values
  (`trackReads`); the recorded read-set is what a selective refresh cascades along.
- **Cancellation = one `AbortController` per bucket.** A function load's second argument
  (`LoadContext`) carries `bucketSignal(bucket)` — created with the level's cells and
  fired by `discardRun` when the run is dropped (see the lifecycle section below). A
  selective `refresh(key)` re-run is handed the same signal: it replaces a load *inside*
  the run, it doesn't discard it. `hook()` loads and sources get none (`detach()` is a
  source's cancellation).
- **Loading = Suspense + slot.** A pending *promise* suspends (the `<Suspense>` fallback is
  the loading slot); a pending *source* sets a pending flag → the loading slot.
- **Errors = the boundary.** A rejected promise (`use()`) or a thrown source error reaches
  `MandalaErrorBoundary` → the `error` slot (switch on `error.code`), or rethrows to the
  nearest outer boundary when there's no slot. With a `retry` policy the boundary gets a
  first refusal on the error — see [the retry policy](#the-retry-policy-retry).
- **Live values = `useSyncExternalStore`.** Each Step subscribes to its level's sources
  through one `useSyncExternalStore`, re-keyed when a cascade swaps a source (the level's
  `sources` array is replaced). (Hook sources own their own subscription.)
- **Levels are named.** `compileLevel` (memoized on the level object, alongside the
  hook/data key split) gives each level a bound copy of `Step` whose `displayName` is its
  keys — DevTools shows `Island(Prefs) → Step(user,prefs) → Step(tree)` instead of
  anonymous Steps. A bound copy adds no fiber, and the identity is stable per level, so
  reconciliation is unchanged. The same `compileLevel` keys feed `dataTrace`'s level lines
  (`util/dataTrace.ts`, the `rati/debug` entry): the resolver hooks a run's timeline at
  level build, cell classification, dirty re-runs, the source snapshot read, and the leaf —
  all no-ops on the `undefined` trace a non-traced run carries.

### The bucket cache lives on the mandala's committed ref

A level's data cells (and its source list) are built once into a `Bucket` held on the
mandala component's `useRef` — **not** on the Step's fiber. A Step that `use()`s a pending
promise suspends, and React discards the suspended render's fiber; a Step-local cell would be
rebuilt on the retry, re-run its load, and re-suspend on a brand-new promise forever. Holding
the bucket on the committed mandala ref makes the load run once per inner-tree generation.
The bucket array is rebuilt only when the inner tree remounts (`treeKey` = inputs version +
retry counter). The full catalog of Suspense-produced situations this design answers is
[suspense-situations.md](packages/rati/src/__tests__/suspense-situations.md)
(`packages/rati/src/__tests__/`).

### Lifecycle & teardown ordering (structural)

- A `Step` **attaches** its level's data sources in a **layout** effect — pre-paint, so a
  synchronously-ready source flips to content in the same frame instead of flashing the
  loading slot for one pass.
- The **detach** side is a **passive** effect's cleanup, and it is swap-aware: it releases
  entries the *live* bucket no longer holds (a cascade swapped the source out) and
  everything when the bucket itself is stale (an inner-tree remount); entries the live
  bucket still holds stay attached (a cleanup can't tell a deps-change from an unmount).
  The mandala's own unmount cleanup runs a **sweep** over the buckets as the backstop, so
  island teardown releases whatever is still attached.
- A run that is **discarded** goes through `discardRun` — the sweep above plus firing each
  bucket's `AbortController`, so the loads it still has in flight are cancelled. Two call
  sites, both effect-time (a discarded *render* must not cancel a live run): the buckets a
  new generation replaced (queued at render, released in the `treeCommitted` effect) and
  the unmount cleanup. Before the abort, every producer-backed promise in the bucket gets
  a no-op rejection handler: a load the level suspended past was never handed to `use()`,
  so its abort rejection has no reader and would surface as an unhandled rejection. For
  the same reason `refreshFailed` stays quiet when the bucket's signal has fired — a
  cancelled re-fetch is not a failed one.
- The `.provide()` value (at the `Leaf`) is built and disposed (`[Symbol.dispose]`) in a
  **layout** effect. On unmount React flushes **all layout cleanups before any passive
  cleanup**, and unmounts **children before parents** → the leaf's provided value disposes
  *before* the sources it was built over detach — the dispose-before-detach order, preserved
  through the sweep (a passive cleanup) by the same phase rule.

An inputs change (by value) bumps `treeKey`, remounting the inner tree under a `<Fragment
key>`: React tears the old run down (children-first) and resolves the new inputs from scratch;
same-inputs source transitions re-render in place, keeping promise/source identity.

### The kept run (`keepStale`, `loadingDelayMs`)

`keepStale` keeps the **run**, not a copy of its props. The mandala holds a `keptRef`
alongside `cacheRef`, and on a `treeKey` change retires the outgoing run into it instead of
queueing it for `discardRun` — so the same buckets that stopped being *rendered* have not
stopped being *owned*. Everything else follows from that:

- **Retire only what committed.** `committedRef` is written by the leaf's layout effect
  (`Shared.commit`), so the baseline is one that actually reached the screen. A run replaced
  before committing goes straight to `orphanedRef` — which is what makes a second param
  change mid-window keep showing the *original* rather than swapping in a half-built one.
- **Teardown deferral is the existing Step pattern, widened.** `Shared.bucketRetained`
  answers for the rendering run *and* the kept one, so the retiring Steps' cleanups leave
  their sources attached. `ProvideLeaf` learns the same test through
  `Shared.retainProvided`, handing its dispose to the mandala rather than running it — which
  is what lets the value channel keep publishing a live `.provide()` value through the
  window. (A props-only snapshot would have had nothing of the right type to publish.)
- **`Shared.slot`** is one element rendered at all three sites that can show something
  other than content: the Suspense fallback, `Step`'s pending-source return, and
  `ProvideLeaf`'s build frame. The mandala decides once per render what it *is* — the kept
  run, the loading slot, or nothing while the delay holds it back — so those three sites
  carry no slot logic at all, and re-renders at any one site reconcile against the same
  element.
- **The kept content is a remount, not the old tree.** The three sites are different fiber
  positions, so the shared element's identity does not carry the component *across* them
  (only within one). Entering the window mounts a fresh instance of the component at the
  not-ready site — usually the Suspense fallback, with React keeping the outgoing run's
  committed tree hidden beside it until the boundary un-suspends — a site move mid-window
  (fallback → a later level's pending source) is another unmount/mount pair, and the swap
  mounts the successor fresh. Component-local state therefore does not survive a stale
  window (measured 2026-07-20; the guide and reference say so). What the machinery keeps
  alive is the run's *resources* — attached sources, the published `.provide()` value —
  never the component instance.
- **The swap is passive, and it is the leaf's.** `Shared.swap` releases the kept run from
  the leaf's *passive* effect: every layout effect of that commit has run by then, so a
  source both runs hold is never detached and re-attached across the window. It cannot be
  the mandala's own effect — a Suspense retry re-renders the boundary's children, not the
  mandala, so the commit that ends the window would not run one. Release order is
  `disposeProvided` then `discardRun`, preserving dispose-before-detach.
- **The Router keys these routes by name.** `Router` normally keys a route's element by a
  per-navigation counter, remounting the component on every navigation — fatal for a kept
  run, which lives on the island instance. `createMandala` hangs `keepsRun` on the
  component (like `preload` / `moduleId`) and `Router` reads it. Opt-in: every other route
  keeps the counter.

### The delay window (`loadingDelayMs`)

`LoadingDelay` (mandala/loadingDelay.ts) is one uSES store per island instance, read by
`LoadingSlot` (render nothing) and by the mandala (keep the previous run on screen). It
engages the kept-run machinery above — `keepsRun` is `keepStale || loadingDelayMs > 0` —
and the only difference between the two options is when the kept run stops being shown:
never, until the successor commits (`keepStale`), or at the deadline, after which a
mandala effect runs the same `releaseKept` the swap does.

- **The window is a stretch without content, not a resolution.** `begin` (render, where the
  generation is built) opens one; `settled` (the leaf's commit) closes it and re-arms the
  next; `expire` (the timer, or the slot rendering itself) ends it and *latches* — so a
  superseding re-resolve neither restarts the deadline nor blanks a slot already up.
- **Opening and arming are split** because the render half runs on the server too. `begin`
  starts no timer: a server render must not leave a `setTimeout` holding the process open.
  `arm` runs from a mandala effect, which the server never reaches.
- **Inert off the client.** Both uSES reads pass `false` as `getServerSnapshot`, which React
  uses for the server render *and* the hydration pass — so a slot that belongs in the HTML
  (`ssr: false`, a source pending server-side, a rejected load) is rendered there whatever
  the deadline says. The slot then calls `expire` from its own render, so the first render
  that consults the *client* snapshot cannot take back what the server shipped.

### The retry policy (`retry`)

`RetryPolicy` (mandala/retryPolicy.ts) is one budget per island instance, driving the retry
counter `bumpRetry` already owned. The boundary asks it before it does anything with a
caught error: an accepted failure returns the mandala's built `slot` (loading, or the kept
run under `keepStale`) in place of the error slot, and a timer re-resolves from scratch
after `backoffMs * 2 ** (attempt - 1)`.

- **`accept` is render-time, `arm` is commit-time** — `LoadingDelay`'s split, for two
  different reasons. Deciding from an effect would mount the error slot for a commit, and
  its effects (a log, a toast, a Sentry report) with it. Arming from render would leave a
  `setTimeout` per island per request holding Node's event loop open — and since only a
  commit can start a timer, and a server render has no commit phase, "the policy is
  client-only" needs no enforcement at all: `prerender` takes its one attempt and the
  collector records the failure exactly as without the option.
- **`accept` is idempotent per generation**, keyed on the boundary's `resetKey` (the tree
  key). The boundary re-renders while it holds an error, and a static rejected promise
  hands the *same* reason object to every generation — the generation is the only identity
  that distinguishes one failure from the next.
- **`failed` only.** `not-available` (or any code a load coins) is an answer, not a fault.
- **The budget is per failure streak**, restored by `reset()` from three places: the leaf's
  commit (content is on screen — hence `Shared.commit` is now wired for `keepsRun` **or** a
  retry policy), a manual retry (the mandala wraps `bumpRetry` for the error slot's prop and
  `fullRefresh`; the policy's own retry is the unwrapped bump), and `committed(version)`
  from the mandala's per-render effect, which drops a countdown belonging to inputs that
  have since changed. That last one *compares* the version rather than resetting
  unconditionally, because it runs after every commit — including the one that armed a
  synchronous first failure's attempt moments earlier.

## The island's phase (`reportPhase`)

`useScopeControls` reports `phase` / `isStale` off a second uSES store on the
`RefreshController`, written by **whatever renders**: `Leaf` and `ProvideLeaf` (`'ready'`),
`KeptContent` (`'ready'`, stale), `LoadingSlot` (`'loading'` — including while the delay
holds it back: nothing on screen is what loading is), and `MandalaErrorBoundary`
(`'error'`). Which slot is on screen is the only
honest definition of an aggregate phase — no single piece of bookkeeping knows it, since a
level can be suspended on a promise, pending on a source, or thrown to the boundary without
the mandala re-rendering at all.

The writes happen **during render**, with the notification microtask-deferred — the same
shape `addPending` established, and for the same reason (a listener setState during render
is not allowed). The payoff is that a subtree reading the status further down the same pass
sees the value that pass produced: the kept run reports stale before rendering the component
under it, so the first stale render is already dimmed rather than flashing undimmed for a
frame.

`retrying` rides the same store but is written by the retry policy, not by a renderer —
`reportPhase` carries it through untouched, and `reportRetrying` carries `phase`/`isStale`
through. An island retrying *is* an island resolving, so there is no fourth phase member:
`phase` reads `'loading'` throughout (or `'ready'` + `isStale`, under `keepStale`).

## Selective refresh (`mandala/refresh.ts` + `controls.ts`)

`useScopeControls(scope)` reads a per-mandala-instance `RefreshController` off the
**controls channel** — a second scope-keyed context registry next to the value channel,
provided by the mandala around its whole inner tree. Design + decisions:
[archive/directions-2026-07/mandala-refresh-and-ssr-sources.md](docs/archive/directions-2026-07/mandala-refresh-and-ssr-sources.md).
The moving parts:

- **Re-runs happen in render.** `refresh(key)` marks the cell dirty and triggers a bare
  re-render; the Step's dirty pass (`processDirtyCells`) re-runs the producer where `prev`
  naturally lives — with current upstream values, including values a cascade swapped in the
  same pass (levels render top-down).
- **Stale-while-refetch, no Suspense re-entry.** The old value keeps rendering while the
  re-fetch is in flight (`lastValue` on the cell); on a *changed* settle the cell becomes a
  **value cell**, so the new value renders synchronously — `use()` never sees a fresh
  promise (which would suspend once even when settled) and the loading slot never flashes.
- **The equals gate.** `deepEqual` by default (reference fast path), per-load override via
  `data(fn, { equals })`. Equal → old value and identity kept, nothing downstream moves.
- **Cascade by read-sets.** A changed key marks dirty every later-level cell whose recorded
  reads contain it; promise re-runs settle through the controller (latest-token wins),
  sync value re-runs gate-and-swap in the same render pass, and a dependent *source*
  re-creation replaces the level's `sources` array (re-keying the Step's effects and uSES
  subscription) with the pre-swap value bridging the new source's pending window.
- **A source is a cascade origin too, not just a target.** Every new snapshot a source cell
  renders goes through the same equals gate, and a moved value calls `valueChanged` — so a
  live source transitioning ready → ready re-runs the loads that read it, exactly like a
  promise settle. Gated on the cell already having a value, so a *first* ready cascades
  nothing (the levels below have not run; the waterfall feeds them the value on its way
  down), and an S8 pending/ready blip recovering onto its old value moves nothing.
- **`.provide()` participates**: the factory's reads are tracked too; a changed consumed key
  bumps a version that re-keys the build/dispose layout effect.
- **The controller's stores.** `pending` (the keys in flight) is a uSES-shaped external
  store; notifications are microtask-deferred because bookkeeping mutates during render.
  Waiters resolve when their key settles; a remount (`treeCommitted`) settles everything
  wholesale. Refresh failures keep the previous value, log, and resolve (fire-and-forget
  callers must not trip unhandled rejections). A cascade-swapped source holds its key in
  `pending` until the replacement's first *settled* snapshot — ready (`sourceReady`) or
  error (`sourceErrored`, on the way to the boundary); an error is a settled state, so the
  error slot never reads a key as re-fetching when nothing is.

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
- The **controls channel** (`controls.ts`) mirrors the same registry pattern for
  `useScopeControls`, carrying the instance's `RefreshController` instead of the provided
  value.

## Sources (`scope/source.ts`)

A `Source<T>` is a reactive `pending | ready | error` machine: `subscribe`/`getSnapshot` are
`useSyncExternalStore`-shaped (the Step reads them through uSES, so transitions re-render;
`getSnapshot` must return a stable reference while unchanged) and `attach()` starts/holds the
underlying work and returns a detach function. The unified `SourceError` collapses
not-available / forbidden / failed into one shape with a machine-readable `code`. CRDT
resources, REST loaders and promises all implement the interface, so the resolver is
source-agnostic. `readySource` / `promiseSource` / `toSource` are the adapters; `toSourceError`
normalizes thrown reasons. The optional `ssr` marker (`SourceSSR<T>`) declares a source
server-resolvable — see the next section.

## The data primitives (`data/` — the rati/data entry)

Experimental, MobX-backed (the entry shares the optional `mobx` peer with `rati/mobx`);
design record: `docs/archive/directions-2026-07/data-package.md`. Factories return plain
observable objects — no classes, no decorators; components read them under `observer`,
scopes await first readiness through `source()`.

- `query.ts` — the atom. `createQuery` is the package-internal factory carrying the
  `onSuccess`/`onReset` hooks the collections build on; the race guard is a `requestId`
  check plus an `AbortController` per fetch. `instanceSource` (shared) implements the
  source contract every read-side primitive uses: pending until first ready, then ready
  forever with the instance itself.
- `itemMap.ts` — the shared reconciler under both collections: the keyed entry map,
  identity-stable reconcile, in-place default updates (shallow-observable rows) or
  app-owned `into` instances, and the `dirty` marking that makes a refresh reapply
  server truth over optimistic patches.
- `collection.ts` / `pagedCollection.ts` — thin compositions: a query (or an array of
  page queries anchoring cursor-to-predecessor) feeding the item map. Pages materialize
  structurally: a `nextCursor` appends an unloaded tail record, `hasMore` derives from
  its existence, truncation drops stale successors when a refreshed page ends the list.
- `mutation.ts`, `form.ts` + `field.ts`, `validators.ts` — the write side and staged
  edits; `form` reaches fields' server-error seam through the package-internal
  `FieldExternalErrors` symbol.

Tests live in `src/__tests__/data/` — deferred-promise fakes walk every phase, no module
mocking.

## SSR dehydration (`mandala/hydration.tsx` + `ssrSource.ts`)

Values resolved on the server are carried to the client through a small, framework-owned
registry, keyed `mandalaId (useId) → scopeKey → value`, in three wire sections:

- **`data` — plain values.** Promise loads, plus `ssr: true` **loader sources**: on the
  server the resolver wraps a marked source's first settle into a promise (`firstSettle` —
  attach during render, subscribe until non-pending, detach; exactly what the marker
  authorizes) and pushes it through the ordinary `use()`/collect path. On the client a
  `data` key short-circuits to a value cell — the load (or loader source) never runs.
- **`seeds` — live-source seeds.** An `ssr: { hydrate, dehydrate? }` source dehydrates
  `dehydrate(value)` into `seeds`; the client creates the source as usual and calls
  `hydrate(data)` **before** attach, so its first snapshot is already ready — no pending
  gap, no double fetch, live afterward.
- **`errors` — dehydrated failures.** Only islands running `ssrErrors: 'dehydrate'` write
  here (see below); omitted from the payload entirely when empty, so the default app's wire
  bytes are unchanged and no version bump was needed.
- Server resolution of marked sources is **gated on the collector being present**: resolving
  without dehydration would hand the client ready HTML over a pending source — a guaranteed
  hydration mismatch. Unmarked sources stay pending under SSR (fallback ships in the HTML).
- `useId()` is stable by tree position across server/client; `collect(mandalaId, key,
  value, kind?)` defaults `kind` to `'value'` (a pre-seeds collector signature keeps
  working). The mechanism is router-orthogonal (a route is just a mandala); public exports
  are the `Hydration*` names re-exported through `rati/ssr`.
- **Error recording.** A promise load that rejects under a collected render never reaches
  the error slot — server rendering has no error-boundary recovery; React emits the loading
  slot with a client-retry marker and the prerender *resolves* (pinned in
  `islandSsrErrors.test.tsx`). The Step attaches a once-per-promise rejection recorder
  when `collectError` is present, guarded by a WeakSet held on the *run* (the generation's
  cache, beside its data trace) — a resumed level must not stack a second handler on the
  same cell, while a later render reusing the same promise instance is a new report, not a
  duplicate (a module-global guard silently emptied the second render's `errors`); the
  collector's `errors` carries
  `{ mandalaId, key, error: SourceError }` — the server's status input (`not-available` →
  404). `asSourceError` (scope/source.ts) is the shared normalization with the boundary.
- **Error dehydration** (`mandala/ssrErrors.ts`): `ssrErrors: 'dehydrate'` is the other
  half of the bullet above — the island that wants its *error slot* in the HTML. The catch
  has to happen in the resolver because React runs no error boundary server-side, and it
  cannot be a `try` around `use()` (a pending `use()` throws too). So the Step waits on a
  **rejection-proof twin**: `promise.then(undefined, reason => new SsrRejection(...))`,
  which resolves where the original rejects. The twins are keyed by promise in a WeakMap on
  the run — `use()` needs one identity across a level's resume, and hook loads have no
  cached cell to hang one on. Recognizing the marker, the Step returns `Shared.ssrErrors
  .slot(error)` — the island's error slot, built by the mandala from the same `config.error`
  the boundary uses; `slot: null` (no error slot declared) leaves the throw, i.e. the
  default degradation. `recordRejection` is untouched: the *original* promise still rejects
  and still carries the recorder, so one path feeds both the status list and — via
  `collectError`'s `dehydrate` flag, bound per island in the mandala — the `errors` wire
  section. `wireError` strips `cause` there (a live `Error` JSON-stringifies to `{}`).
  Client side, `buildCell` short-circuits a key present in the slice to a **fourth cell
  kind**, `{ kind: 'error' }` — `SourceState`'s third member in cell clothing — which the
  resolve pass throws, so a dehydrated failure and a source failure leave by the same door
  (the boundary, hence SI-05's `retry` policy applies to both). Gated on the collector for
  the same reason marked sources are; gated on `firstMount` for the same reason `data` is.
  Pinned in `islandSsrErrorDehydration.test.tsx`; throwing during hydration into a boundary
  is *not* a recoverable error (measured — React re-creates the subtree and reports
  nothing), which is what makes the round trip silent.
- **The per-island opt-out** (`mandala/afterHydration.tsx`): `ssr: false` wraps the Step
  tree in `AfterHydration`, whose gate is `useSyncExternalStore`'s `getServerSnapshot` —
  which React reads on the server *and* through the client's hydration pass. So the server
  renders the loading slot (no Step renders → no cell is built, no load starts, the
  collector never hears from this island), the hydration pass renders the same slot
  byte-identically, and only the post-hydration re-render resolves. Suspending *during*
  hydration is what this buys off: React would throw the boundary away and client-render
  it, which surfaces as a recoverable error. A client-only mount reads `getSnapshot` on its
  first render, so the option costs nothing there. Note this is a render-phase test of
  "am I the server", not a collector check — the option means the same thing under a bare
  `prerender`. The option is the island's, so it sits *above* the source markers above: an
  `ssr: true` source inside an opted-out island never reaches `buildCell`'s promotion.
- **Claim watchdog** (`hydrationDiagnostics.ts`): on a rehydrating client, `buildCell`
  claims each consumed `data`/`seeds`/`errors` slice; slices still unclaimed a grace period after
  the last claim get one console.warn — the loud version of "the trees drifted, the useId
  keys shifted, SSR silently turned itself off".

The routing snapshot is separate: `prepareRoute(router)` (`router/prepareRoute.ts`) drives a
memory-history router to its matched route and returns the server's decision object:
`RouterHydratedState` (seeded back via `RouterStoreOptions.hydratedState`),
`matchedCatchAll`, and the followed `redirect`, if any.

## The rati/ssr entry (`ssr/`)

`renderApp` (`ssr/renderApp.tsx`) composes the per-request loop — memory history → the
app factory → `prepareRoute` → `renderToHtml` → dispose — into the decision object the
public docs describe (`docs/public/ssr.md`); `renderToHtml` is the `prerender` stream
drain, and raises `progressiveChunkSize` out of reach so React inlines every completed
boundary instead of outlining it into a hidden div + swap script (buffered output — the
outlining is streaming's machinery, and the file says why); `payload.ts` owns the wire format (versioned `HydrationState`, the inert JSON
script tag, the dev round-trip warning); `headTags.ts` is the head store's post-prerender
read-back (escaped, `data-rati-head="server"`-marked — the attribute so the client
reconciler adopts the tags, its `server` value as evidence for the hydration phase below).
`react-dom/static` is imported statically — it has browser builds, and `sideEffects:
false` keeps it tree-shaken out of client bundles that touch only `readHydration`.

## The rati/vite entry (`vite/`)

Two jobs, one plugin, coupled to the engine by nothing but the `render(url)` contract.

**Dev** (`ratiSsr.ts`): a catch-all middleware installed *after* Vite's own (the
`configureServer` return-a-hook form, so module/HMR requests never reach it),
`ssrLoadModule`s the entry, maps the result kinds onto the response, and assembles
through `ssr/html.ts`. `appType: 'custom'` drops the SPA middlewares. `hotUpdate`
full-reloads only for modules the client graph doesn't have — a shared component is Fast
Refresh's. `transformHtml` retries `transformIndexHtml` with every `%` escaped when it
throws a URIError: Vite decodes the URL to name the HTML file for the html hooks, so a
malformed escape (`/products/%zz`) throws there, past the app's already-rendered 404, and
dev would answer a bad address with the overlay where production answers the app. Only
the transform's copy — the app renders from the raw URL. Retried rather than sanitized up
front because a probe (decode it, escape on throw) is a pure call whose result is unused:
the bundler drops it and the *published* plugin gets an identity function, which the tests
cannot see because they run this source.

**Build**: `config()` returns `builder: {}` (opting into the app builder) plus the two
environments' outDir/manifest/input, and the `buildApp` hook builds client → ssr. The
order is load-bearing, not a preference: `load('virtual:rati/assets')` in the ssr build
inlines the hashes the client build just produced. The manifest is captured from the
client `writeBundle` in memory, and the plugin is `sharedDuringBuild: true` so it is one
instance across both environments — reading the written file instead would let an older
build's manifest through, which is a page whose script 404s.

`assets.ts` generates the module: a frozen literal (three values, no manifest and no
lookup code in the server bundle), URLs under `config.base`, and per-route preload tags
walking the manifest's static-import closure minus whatever the entry already brings.
`devAssets` is the same shape with the source entry and no tags — Vite serves both
through the module graph, so there is nothing to hash and nothing to preload.

`lazyModules.ts` is the specifier transform (design record:
`docs/archive/directions-2026-07/ssr-server-kit.md` — the primary, not the `routeChunks`
fallback). It parses with `parseSync` (which takes the filename: route tables are TSX,
and the deprecated `parseAst` throws on them), matches only calls to a local bound to
*rati's* `lazy` import, and appends the root-relative id — which is exactly how the
client manifest keys a dynamic entry. It runs only in the ssr build (dev has no chunks;
the client bundle has no reader) and returns `map: null`, since a one-line insertion
after the code it follows moves nothing.

## The rati/server entry (`server/`)

Layer 3 of the kit — production only, and split by platform, not by feature.

`requestHandler.ts` is platform-free: a `Request` in, a `Response` out, assembling
through `ssr/html.ts` (the same code the dev middleware runs, so a page cannot come out
of dev one way and out of production another). The result kinds are settled policy by the
time they arrive — `renderApp` derived the status — so it maps rather than decides.

The **CSR fallback** is the one decision it does make, and the reason it takes `assets`
at all: a rendered page carries its own tags (folded into `headTags` by `renderApp`), but
a render that *threw* has no result to fold into, and the shell has carried no `<script>`
since SSR-02. So it fills the template with the assets tags, an empty root and no
payload, at 500 — which is only a working page because the client entry calls
`createRoot` when it finds no payload. No `bootstrapModules` and it answers plain text
instead: a shell that loads nothing is a blank page with a 500 on it. The design record
notes this against its own "Layer 3 needs no assets" line.

A **whole-document app** has no template, and `template === undefined` is already what
says so (`assemble` reads it the same way), so the fallback branches there rather than on
a new option (SSR-12): `synthesizeDocument` emits `<!doctype html>` plus the asset tags
and nothing else, and the client entry mounts `createRoot(document)` on it. The emptiness
is load-bearing, not minimalism — React's client render into a *document* container calls
`clearContainerSparingly`, which keeps `SCRIPT`/`STYLE`/`LINK rel=stylesheet` and drops
everything else, so a document holding only those cannot orphan the entry that is running
the mount. Anything added there would silently disappear client-side.

Reading one signal two ways costs a guard (SSR-15). `assemble` decides whole-document by
*content* (`isWholeDocument(result.html)`) and the fallback by *config* (`template ===
undefined`), so a fragment app misconfigured with no template threads the gap: the render
succeeds, `assemble` throws the "pass your index.html" config error, and the fallback —
seeing no template — would synthesize a document with no `#root` for that app's entry.
So that throw is an `Unservable` (a private Error subclass, the only thing the type is
for) and the catch answers it plain-text 500, which is what it answered before the
fallback existed. `onError` still reports it either way. The fallback's
`template === undefined` branch is thereby reached only by apps that really do render
whole documents — every *render* failure still gets the shell.

One sibling gap stays open, on purpose (post-close review, 2026-07-17): a fragment app
whose template exists but lacks `<!--app-html-->` throws a plain `Error` from `fill`
(not `Unservable`), routes to the fallback, and the fallback *tolerates* the missing
placeholder — its `html` part is empty, and `fill` skips an absent slot for an empty
value — so it serves the template as a 500 CSR shell. That shell boots iff the template
carries a literal mount node (`<div id="root">`), which the handler cannot know. Left as
is: in the common case (comment deleted, mount node kept) the fallback is strictly
better than a plain 500, the same misconfiguration throws the same loud error in dev
through the same `fillTemplate`, and `onError` reports it on every production request.

`createRoot(document)` is undocumented-but-real (the types, `isValidContainer`'s
`nodeType === 9`, and browsers all take it; react.dev names `document` only under
`hydrateRoot`). The maintainer accepted that on condition of the canary in
`__tests__/ssr/wholeDocument.test.tsx` — it mounts a synthesized document through
`createRoot` and asserts a working page with `onRecoverableError` never fired, so a React
release that narrows the container is rati's failure, not a consumer's. Note the assertion
is that, and not a console spy: React reports a recovery to `onRecoverableError`, whose
default is `reportGlobalError` — a console-only check passes right through a mismatch that
React papered over. If the canary ever fires, the escape hatch is `hydrateRoot(document)`
against the same shell (recovery reaches the same page, noisily).

`node.ts` is the only file in the kit that knows a platform. `IncomingMessage` →
`Request` (streamed body with `duplex: 'half'` for non-GET; the origin comes off the Host
header, since the handler only reads path+query) and `Response` → `ServerResponse`
(`getSetCookie()` separately, because every other header folds into one comma-joined
value). Static files live here because nobody else wants them — Vercel has a CDN, Hono
has serve-static — and with them the MIME table, which is why the file exists at all.

`staticPath` decodes *after* `new URL()` normalizes, so containment is checked on the
resolved path rather than by prefix-testing the request. Both halves earn their place:
a prefix test would call `dist/client-secrets/x` a match for `dist/client`, and while
plain `..` is folded and clamped at the root by normalization (landing harmlessly
in-dir), `%2f` is not a separator to the URL parser — it survives intact and becomes a
real traversal on decode. That case is unit-tested rather than driven over the socket:
`fetch` folds `..` away before it sends, so the request that means it is hand-written.

## Head management (`head/`)

The store is registration-sequence based: declarations `set()` during render (so a
prerender sees them — effects never run there), the client effect `commit()`s them, and
client winners count only committed entries so a render React abandoned can't leak a
title; a value update keeps its seq, so deepest-registered keeps winning. One store per
tree, enforced by a null context default (no module-global fallback — that's a
cross-request leak on the server). `domSync.ts` reconciles `document.title` plus the
`data-rati-head`-marked metas from `HeadProvider`'s effect.

The store also carries a **phase** (`hydrating` → `live`, one-way), because the entries
cannot tell "nothing declared yet" from "nothing will be declared" — and above a
still-unhydrated boundary those call for opposite acts (SSR-07). While `hydrating`,
`domSync` applies declared winners but writes no `defaultTitle` and removes no marked
tag: `snapshot('hydrating')` is `'client'` minus the default fallback. `remove()` settles
the store — an unmount can only follow its subtree's hydration, and it is the earliest
churn signal; `commit()` doesn't, since on a multi-boundary page one boundary's commit
says nothing about its siblings, and a `remove()` that removed nothing doesn't either
(`useHeadTag(null)` calls it on mount). `HeadProvider.settle()`s on mount when the
document holds no `data-rati-head="server"` tag — rati didn't render this head, so there
is nothing of the server's to protect and a client-only app behaves as it always did.

The marker's value carries that provenance because the two jobs are different: the
attribute is bookkeeping (which tags are rati's to reconcile), the `server` value is
evidence (this head came from a prerender). A client-only app leaves its own marked
metas in `<head>` when a root unmounts — React destroys the provider's subscription
before it reaches the declarations' `remove`s, so the reconcile that would drop them
never runs — and a fresh store reading those as a server head would protect one that was
never there, leaving a client-only page that declares no title without its
`defaultTitle`. Hence `server` vs `client`; both still reconcile.

## Router (`router/`)

`RouterStore` (`store.ts`) owns history, the active route, basename
handling, and navigation (`navigate`/`replace`/`setSearchParams`/`preloadRoute`). It is a
plain external store — a listener `Set` plus `subscribe`/`getSnapshot` (a version counter);
`useRouter` reads it through `useSyncExternalStore`, so every consumer re-renders on a
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
- A data producer runs **at most once per inner-tree generation** (Suspense replays and
  render discards never re-run it), plus explicitly modeled refresh re-runs — the contract
  the fuzz suite's run-count invariant pins
  ([archive/mandala-testing.md](docs/archive/mandala-testing.md)).

## Testing

Suites live in `packages/rati/src/__tests__/` (deterministic `mandala/`, `router/`, `scope/`
plus the randomized `fuzz/`). The testing strategy — the contract-altitude rule, the
deterministic pin list, the fuzz harness design — is
[archive/mandala-testing.md](docs/archive/mandala-testing.md); the execution effort is
[docs/archive/efforts/mandala-fuzz/](docs/archive/efforts/mandala-fuzz/README.md). Suspense-facing testing rules
(the async-act mount requirement above all) are cataloged in
`packages/rati/src/__tests__/suspense-situations.md`.

The utilities the suites lean on ship as the public **`rati/testing`** entry (`src/testing/`
— `deferred`, `flush`, `controllableSource`, `renderIsland`, `createTestRouter`,
`renderWithStores`, `prerenderToString`/`ssrRender`), so both a consumer and rati's own suites
use one implementation. It is *promotion*: the generic cores were extracted out of the ~8
hand-rolled `testSource`/`loaderSource` copies, the `deferred`/`flush` idioms, the island
mount + slot-reader hand-inlined across the mandala suites (now `renderIsland` + `slot()`,
which wraps each slot in a private marker so testids stay out of the island API), and the
`createMemoryHistory` + `new RouterStore` + provider dance inlined across ~20 router suites
(now `createTestRouter`, over a memory history it disposes). The three render harnesses share
one mount (`testing/dom.tsx`: `mountTree` + a single `cleanup()` + a per-mount dispose hook —
where a test router's history is detached). `renderWithStores` is the stores-injection seam: a
partial container behind `RootStoreProvider`, killing the `as unknown as GlobalStores` cast
the component suites hand-roll (it builds on the shipped `RootStore`/`RootStoreProvider`, not
on any internalized context — see the effort README's DX-03 delta).

The **SSR round-trip kit** (`testing/ssr.tsx`) is the same promotion for the prerender→
collect→hydrate loop hand-rolled across the `islandSsr*`, `router/hydration`, and `ssr/*`
suites: `prerenderToString` is the bare `react-dom/static` drain loop (no-outlining budget,
like `rati/ssr`'s `renderToHtml`); `ssrRender` wraps a fresh `createHydrationCollector` +
`HydrationProvider` around it and returns the HTML + `data`/`seeds`/`errors`, with a
`.hydrate()` that feeds the payload back through a client-side `HydrationProvider` and
`hydrateRoot` (a fourth `testing/dom.tsx` mount, `hydrateTree`, so `cleanup()` tears
round-trips down too). Its two added judgments over the hand-rolls: a recoverable hydration
error (React client-rendering over mismatched markup) throws by default — the mismatch made
loud — with an `allowMismatch` opt-out for the deliberate-degradation pins; and an opt-in
`settleTimeout` that turns a render which never settles into a report instead of a runner
timeout. The budget runs over `prerender`'s own `signal`: aborting *resolves* the prerender
(it never rejects) and calls `onError` once per still-pending task, with the abort reason and
that task's component stack — so the abort is both the release valve and the census the
failure message quotes. `postponed !== null` (React's "did not complete" flag) gates the
throw, so a budget expiring during the drain of a finished render can't fail a good test. The route-level
round-trip stays a *documented composition* (build the two routers + `prepareRoute`, pass both
trees to `ssrRender`/`.hydrate`) rather than a helper, to keep the router-SSR wiring out of the
entry.
The `fuzz/` harnesses keep their own **model-wired** drivers — `scopeHarness.tsx`'s
`controllableSource` carries a ledger tied to the reference model (depth/`maxConcurrent`), a
`recompute` closure, and its own testid slot readers, and its mount is instrumented for the
command model — none of which belong in the generic core; that reconciliation (and deleting
the remaining deterministic-suite duplicates behind the entry) is the
[testing-and-dx effort](docs/planned/testing-and-dx/README.md)'s later dogfood sweep. Effort
record for the entry: [planned/testing-and-dx/](docs/planned/testing-and-dx/README.md).

`fuzz/` holds two targets sharing one budget convention (`fuzz(n)`, `FUZZ_RUNS`,
`FUZZ_LEVEL`, `FUZZ_SEED` — documented in `fuzz/arbitraries.ts`): the mandala's scope
harness (`scopeHarness.tsx` / `model.ts`) and the router's route-table harness
(`routerHarness.tsx` / `routerModel.ts`, effort
[docs/archive/efforts/router-fuzz/](docs/archive/efforts/router-fuzz/README.md)). Each model is plain JS with no
imports from the engine it mirrors — where the router compiles a regex, its model walks
segments — so a bug cannot hide behind a model that shares the implementation.

**A hydrating mount that claims "no mismatch" passes its own `onRecoverableError`** and
asserts it never fired (SSR-14). A console spy cannot see a mismatch: React reports one it
recovered from — by client-rendering the boundary, which is exactly the failure worth
catching — to `onRecoverableError`, whose default is `reportGlobalError`, not
`console.error`. Under Vitest that default lands as an "Unhandled Error" the reporter
prints and no assertion reads, so a console-only check passes straight through. Both
channels are worth asserting where a mount claims a clean hydration (`console.error` still
carries React's own warnings), but only the first one is about mismatches. The deliberate
mismatches — `mandala/islandSsrSources.test.tsx`'s pin 7/7b, where the recovery *is* the
degradation being pinned — pass a no-op `onRecoverableError` for the same reason: to keep
the report from leaking out of the run, per-mount rather than as global suppression.

**Verifying SSR in a browser: use a visible tab.** React 19.2 gates the Suspense reveal on
`requestAnimationFrame`, which never fires in a hidden or backgrounded tab — and since rati
wraps every route in a boundary, a headless/background browser leaves the page at its
loading slot forever. A healthy server-rendered page reads as a broken hydration, and any
real bug on the page hides behind that. So before believing a hydration failure, check
`document.hidden`; screenshot and step through SSR pages in a tab that is actually on
screen.

The whole gate runs as one command: `yarn ci` (`scripts/ci.ts`, plain Node over zx) — fmt,
lint, typecheck (every workspace), the full test suite, the fuzz suites at a deep budget
(default `FUZZ_RUNS=500`, override via env), and the builds. Every stage runs even when an
earlier one fails; the summary aggregates. It stands in for hosted CI until a lane is worth
wiring, at which point a job runs the same file unchanged.

## Toolchain

rati runs on **Vite+** (`vp` — bundles Vite/Rolldown, Vitest, oxlint, oxfmt). Lint/format
config lives in the root `vite.config.ts` `lint`/`fmt` blocks (no eslint/prettier); Node is
pinned to 26 via `devEngines.runtime`.

Types: **tsc** — the released **TypeScript 7** native compiler (the `typescript` 7.0.x dep;
Yarn is pinned ≥ 4.17.1 in `packageManager` for the berry#7190 gate, without which the first
install crashes). `vp run typecheck` type-checks (`tsconfig.json` for src,
`tsconfig.test.json` for the test tree), `vp run build` emits `.d.ts` via
`tsc -p tsconfig.build.json`, and Vitest's `--typecheck` pass over `*.test-d.ts` uses tsc
through `test.typecheck.checker`. The whole repo is decorator-free (the legacy `data/`
layer that needed `@babel/plugin-proposal-decorators` is gone; `rati/data` uses plain
observable objects from factories), so there is no Babel in the toolchain.

Lint deviates from a stock config for a generics-heavy framework: the type-machinery rules
(`no-explicit-any`, `no-non-null-assertion`, `no-empty-object-type`,
`no-redundant-type-constituents`) are `warn`, and `no-unnecessary-type-assertion` is `off`
because tsgolint's necessity analysis disagrees with tsc (it ignores
`noUncheckedIndexedAccess` and strips load-bearing generic casts). tsc is the authoritative
type gate. Commands: `vp build` / `vp test` / `vp run typecheck` / `vp lint` / `vp fmt` /
`vp check`. Releasing: [RELEASING.md](RELEASING.md).
