# Data views & islands — working plan

> **Living document.** Successor to the frozen first draft
> [`data-views.md`](./data-views.md). Edit *this* file. Where the two disagree, this
> one wins. The sections under "Direction" / "Source state machines" / "Open
> questions" / "Issues" are new; everything below the divider is inherited from the
> first draft and will be revised as the plan firms up.

Status: **planning** (June 2026). Builds on the experiment in
`packages/rati/src/experimental/`.

## Direction — set 2026-06-22

Two calls from the project lead; the rest of this doc is read in their light.

1. **Islands absorb views; views get dropped.** Island functionality is extended to cover
   everything views do (the data chain, routing, SSR), then views are removed. Corollary:
   **stop growing the shared view/island surface** — the shared core is temporary, not an
   investment. This is the "upward lift" the first draft's Discussion gestured at, now committed.
2. **Decouple islands from the resource layer.** Islands must not know about `ResourceContainer`
   / grab / release / `Symbol.dispose`. They reach data only through one reactive *source*
   interface; CRDT resources are one implementation of it.

(Flagged as upcoming, not designed here: **auto-context creation** is a near-future step — the
island will hand its data to the subtree without manual providers.)

## Decisions — 2026-06-22

- **Scope: islands only; do not touch views yet.** SSR is out of focus for now (Q6 → deferred).
  Revisit before views are actually removed.
- **The source interface is source-agnostic.** CRDT resources implement it; **REST-API loaders may
  implement the same interface.** The island never knows what is behind a source — that *is* the
  decoupling. (Resolves the "In the same way…" note.)
- **Lifetime: explicit `attach()` / `detach()`** (Q2 → b). The island attaches each source on
  mount / param set and detaches on unmount / param change. No implicit observation-driven teardown.
- **Dependencies: keep the chain** (Q1 → keep). Levels stay; a dependent level builds its source
  from prior ready values. The free dependency-graph generalization is researched below — its
  types are the interesting part.
- **ready → pending: drop to pending** (Q3 → drop), *for now*. Next step combines both: keep the
  ready render as **stale** for *n* seconds, then fall back to pending. Design the phase model so
  "stale" is expressible from the start — don't hard-code an immediate drop.
  - **Where this actually fires (dormant today):** jnana's CRDT page/tree sources never go
    `ready → pending` — `YDocLoader.#materialization` is monotonic to a terminal (`pending →
    ready | error`, then the meta observer detaches), so `ready` is final and live edits stream
    through the grabbed store without touching load state. The drop-to-pending path is exercised
    only by a source that *chooses* to regress: a REST/keyed-data source revalidating, or a
    future loader that surfaces reconnect/offline as a non-ready state. What *does* happen today
    is the reverse upgrade — `not-available → ready` (a doc created elsewhere): the island doesn't
    detach on error, so the source stays attached and auto-upgrades out of the error slot.
- **Still open:** error value shape (Q4), promises/values auto-wrapped as sources (Q5), the exact
  observable `state` shape (Q7), sequencing + the loader-state adapter (Q8).

## Source state machines (the new resolved-prop model)

An island stops resolving promises and instead **observes sources**. A source is a MobX state
machine:

```
pending | ready(value) | error(reason)
```

- **Live, never final** — a source may transition at any time (reconnect, availability flip,
  refetch), not only once.
- **Island aggregation** over its sources:
  - all `ready` → render the **main** component, fed each source's `value`;
  - any `error` → render the **error** component;
  - otherwise → **pending**.
- **One error state.** not-available / forbidden / failed / timeout / … collapse into `error`,
  because the island's *behavior* is identical; a `code`/`reason` carried on the error lets the
  error component render the right thing. (Replaces the first draft's separate `notAvailable`
  slot — the 404-vs-500 distinction moves from the framework into the app's error component,
  switching on `code`.)
- **Sources implement an interface; the island only knows the interface.** CRDT resources
  implement it; tier-1 keyed data and `remoteData` should too. That interface *is* the
  island↔data boundary — the decoupling itself.

> **Note — your message trailed off at "In the same way ___".** Please finish it so I capture
> the intended parallel (auto-context? non-CRDT sources implementing the same interface? a
> value accessor?). I assumed "other data sources implement the same interface" below.

## What this model buys

- **Both first-draft "stretch" items fall out for free:**
  - *Reactive availability (absent → ready):* the source flips `pending → ready` and the island
    follows — no terminal not-available, no forced re-navigation.
  - *Safe in-place re-resolve:* there is no promise to cancel and no grab-proxy to dispose
    mid-render, so the `key={pageId}` remount on `PagePanel` stops being load-bearing.
- **Retires the disposal contract:** no `Symbol.dispose` probing, no `has`-trap impedance
  mismatch (the thing just removed). Lifetime moves to observe/attach — see Q2.
- **Sets up auto-context:** the island already holds the ready sources to hand down.

## Research: the dependency graph, and its types

The chain we're keeping is one shape of a more general idea — a **reactive dataflow graph** of
sources. Worth pinning down the general form, because the prop types fall out of it and it frames
later moves (auto-context, the eventual "stale" phase, possible partial rendering).

### Two ways to wire dependencies

**G1 — sources as first-class values (combinator style).** A source is `Source<T>`; dependents
are built by a combinator over upstream *ready values*:

```ts
const spaceId = resolveSpace(slug);                          // Source<Uuid>
const tree    = derive([spaceId], ([id]) => loadTree(id));   // Source<Tree>
const pageDoc = derive([spaceId, pageId], ([id, pid]) => loadPage(id, pid)); // Source<Doc>
```

```ts
type SourceValue<S> = S extends Source<infer T> ? T : never;

function derive<Deps extends readonly Source<any>[], T>(
    deps: Deps,
    fn: (values: { [K in keyof Deps]: SourceValue<Deps[K]> }) => T | Promise<T> | Source<T>
): Source<T>;
```

The combinator owns propagation: any dep `pending` → result `pending`; any dep `error` → result
`error` (forwarded); all `ready` → run `fn`. So **`fn` is total over ready values** — it never
sees pending/error. Types are clean and *compose*: each `derive` is its own inference boundary,
deps are already-typed `Source` values, `SourceValue` pulls out `T`, nothing self-referential.

**G2 — flat declarative record (deps inferred from what each function reads).**

```ts
const graph = sources({
    space:   param<string>(),
    pageId:  param<Uuid>(),
    spaceId: ({ space })           => resolveSpace(space),
    tree:    ({ spaceId })         => loadTree(spaceId),
    pageDoc: ({ spaceId, pageId }) => loadPage(spaceId, pageId),
});
```

Reads best — pure declaration, dependency = which sibling keys a function destructures, framework
topologically sorts. But the types fight back:

```ts
type Resolved<G> = {
    [K in keyof G]: G[K] extends Param<infer T>     ? T
                  : G[K] extends (d: any) => infer R ? Awaited<UnwrapSource<R>>
                  : G[K] extends Source<infer T>     ? T
                  : G[K];
};

type GraphDef<G> = {
    [K in keyof G]:
        | Param<any>
        | ((deps: Omit<Resolved<G>, K>) => any | Promise<any> | Source<any>) // can't depend on self
        | Source<any>;
};
```

`Omit<Resolved<G>, K>` neatly forbids the trivial self-cycle, but **`Resolved<G>` references `G`
while `G` is still being inferred from the object literal** — self-referential contextual typing.
TS can sometimes resolve it, but this is exactly the fragile case `.chain()` was built to avoid:
each `.chain()` slices the graph so a level's input type is `ResolveViewDefinition<PrevDefs>` — a
*closed, already-known* type, never self-referential. And the type system can't express "depend
only on your topological predecessors" beyond `Omit<…, K>` (no transitive-cycle prevention).

### Conclusion: the chain is the graph's typeable normal form

A `.chain()` is a **depth-layering** of the DAG (longest-path layers); props within one level
resolve in parallel, so the chain already expresses fan-out and diamonds: `{A}` → `{B, C}` →
`{D}`. What a *free* graph buys over depth-layering is finer scheduling — if `B` is slow and `D`
needs only `C`, a free graph starts `D` as soon as `C` is ready, while the chain's level-3 waits
for all of level-2. For UI waterfalls that's rarely worth the typing cost. So: **keep the chain**,
and treat G1's `derive` as an **escape hatch** for the odd cross-level dependency that doesn't
justify a whole new level.

### What this does to the prop types

Almost nothing — that's the point. Keeping the chain, absorbing sources needs **one extra unwrap**
in `ResolveViewDefinition`: `Source<T> → T` (and a function returning `Source<T>` resolves to `T`).
The component still receives plain `T`s.

Crucially, **because errors are unified and handled at the island level (all-or-nothing), they
never enter the prop types** — no `Result<T, E>` leaks to components. The day we add
progressive/partial rendering is the day per-prop `SourceState<T>` would have to surface in the
props and components would branch; the all-or-nothing decision is exactly what keeps props as
clean `T`s. (So "drop to pending / later stale" stays an island-level phase concern, never a
per-prop type.)

### MobX is already the graph engine

If each source is a MobX observable/computed and dependents read upstream `.value` inside
reactions, MobX handles invalidation and recompute — the "graph" *is* the MobX dependency graph,
and `chain` is typed sugar over it. Value-flow (MobX) and resource-lifetime (explicit
`attach`/`detach`) are orthogonal, so this composes with the lifetime decision. The framework's
job then shrinks to three things: the typed façade (`Source<T> → T`), the attach/detach lifetime,
and the `pending | ready | error` **aggregation → slot** mapping.

## Open questions — answer before refactoring

> Q1, Q2, Q3, Q6 are resolved in **Decisions** above; Q4/Q5/Q7/Q8 remain. Kept here for rationale.

Each carries my current lean; correct where wrong.

1. **Dependencies / the waterfall.** Today `chain` levels are sequential and a level's functions
   receive prior *resolved values* (`spaceId` → load `tree` → load `pageDoc`). In a machine
   world, how is "B needs A's ready value" expressed?
   - *Lean:* keep the `chain` shape; a dependent level constructs its source **lazily**, only
     once the prior source is `ready`, reading the prior `value`. Preserves the visible
     waterfall; the unit changes promise→source. Alternative: a reactive graph where sources
     hold each other's observable values (more powerful, fuzzier ordering). Which?
   - Sub-question: if A is live and flips `ready → pending` again, does B tear down and rebuild
     (cascading invalidation)?

2. **Lifetime / ref-counting.** "Decoupled" still needs *something* to bound a resource's life
   to the island's. Two shapes:
   - (a) **Implicit via MobX** `onBecomeObserved`/`onBecomeUnobserved`: the island just reads
     `source.state`; observation drives load/teardown, ref-counted inside the resource. Fully
     decoupled — no grab/release in the island. Risk: unobserved fires in render gaps → needs a
     keep-alive/debounce.
   - (b) **Explicit** `attach(): () => void` the island calls on mount / drops on
     unmount/param-change. Predictable; slightly more contract.
   - *Lean:* (a) if the timing proves robust, else (b). This shapes the interface — need your call.

3. **ready → pending re-entry policy.** A source that was `ready` returns to `pending` (resync).
   Does the island (i) drop to the pending slot (flicker, subtree state lost) or (ii) keep the
   last ready render while the source refreshes?
   - Related: value *updates within* `ready` flow reactively to an `observer` main component —
     the island swaps slots only on **phase** change, not on every value change. For CRDT the
     `value` is a live store, so passing it and observing is natural.
   - *Lean:* distinguish *initial* pending from *refresh*; keep-previous on refresh; slot swaps
     on phase only.

4. **Error shape.** You said it's open. Proposed minimum:
   ```ts
   type SourceError = { code: string; message?: string; cause?: unknown; retryable?: boolean };
   ```
   `code` an open string (`'not-available' | 'forbidden' | 'failed' | …`) the error component
   switches on. Retry: island-level `retry()` rebuilds sources; a live source may also self-clear
   (reconnect) → island auto-recovers. Good, or do you want a closed union / richer reasons?

5. **Plain values & promises.** Keep accepting them, auto-wrapped (value = instant-ready;
   promise = pending→ready/error), so non-resource props need no ceremony? *Lean: yes —
   "everything is a source," promises/values are degenerate sources.*

6. **SSR — the big one.** Dropping views drops rati's only SSR-complete path
   (`prepareRoute` → `resolveView` → hydrate). A live machine has no natural server snapshot. The
   interface likely needs an awaitable settle, e.g. `whenSettled(): Promise<void>` (resolves at
   first `ready`/`error`), so the server can `await` all sources, then snapshot values for
   hydration. Is SSR **in scope for the new island now**, or explicitly **deferred** (accepting a
   temporary regression until islands ship a settle-and-hydrate path)? This gates the interface.

7. **The interface, concretely.** Strawman to react to:
   ```ts
   interface Source<T> {
     readonly state:
       | { status: 'pending' }
       | { status: 'ready'; value: T }
       | { status: 'error'; error: SourceError };
     attach?(): () => void;          // Q2 — present iff explicit lifetime
     whenSettled?(): Promise<void>;  // Q6 — present iff SSR/prefetch
     retry?(): void;                 // Q4
   }
   ```
   Is `state` a single observable discriminated union (clean to aggregate), or separate
   `status`/`value`/`error` fields?

8. **Sequencing.** Prototype the `Source` interface + the aggregating resolver behind
   `experimental/`, migrate `PageIsland` as the proving ground, then generalize — vs a wider
   rewrite up front? *Lean: prototype + PageIsland first.* And: do the `tree`/`pageDoc` CRDT
   stores implement `Source` directly, or via a thin adapter over the existing loader state
   (which already exposes `loading | ready | not-available | error` in `YDocLoader.state`)? The
   adapter looks nearly free.

## Issues & risks

- **SSR regression (highest).** See Q6. Views are SSR-mature; the new island is client-only
  today. Don't drop views until the island has a settle-and-hydrate path — or consciously accept
  the gap.
- **Lifetime isn't eliminated, only relocated.** "Decoupled" holds at the *type* boundary (island
  sees only `Source`), but resource liveness must still track island presence — Q2 is where the
  old grab/release reappears, hopefully as observation.
- **Flicker / lost subtree state on ready → pending** if the policy is "drop to pending" (Q3).
  Dormant for jnana's CRDT sources (their `ready` is terminal — see Decisions); it would bite a
  source that revalidates (REST) or surfaces reconnect as non-ready. Not a live regression today.
- **All-or-nothing aggregation forecloses progressive rendering** (one slow/errored source blocks
  the whole island). Matches your spec; confirming progressive/partial props stays out.
- **Aggregation granularity.** The island must read every source's `state` inside a reaction
  (`observer`) and pass *live* values (not snapshots), so in-`ready` updates reach components
  without a slot swap.
- **`error` collapse keeps a machine-readable `code`.** Routing/SSR may still need to map
  `code: 'not-available'` to HTTP 404 even though the UI behavior is unified — so `code` must stay
  machine-readable, not just display text.

---

*Below: inherited from the first draft, kept for reference; will be revised as the plan firms up.*

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
