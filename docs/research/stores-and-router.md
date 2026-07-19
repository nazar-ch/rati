# The stores container, the router, and the dependency cycles

The pattern under review: a single container class whose fields are the app's stores, each
store receiving the container so it can reach siblings without injection wiring —
`this.stores.router.activeRoute`, and in nested graphs
`this.stores.rootStores.router.activeRoute` (Jnana's `WorkspaceStores`). rati ships the
skeleton (`RootStore`, `GlobalStore`, `GlobalStores`, `createUseStoresHook`); Jnana's
`GlobalStoresContainer` is the real instance.

## Verdict up front

The container pattern is **worth keeping** — it is the MobX "root store" pattern, and its
ergonomics are real. The pathology is not the container; it is **the router living inside
it while owning the route table**. The recommendation (Option A below): construct the
router outside the container and hand the container a router surface typed off the
`RatiUserTypes` augmentation instead of the routes generic. That removes both cycles
structurally, keeps `stores.router.activeRoute` working verbatim, and costs almost nothing.

## What the container buys (why it's useful)

- **One composition root.** The whole store graph is built in one readable place
  (`globalStores.ts`), in declaration order — no DI framework, no decorators, no tokens.
- **Sibling access without ceremony.** `SearchStore` reads
  `stores.rootStores.router.activeRoute`; `SpaceSyncStore` reaches `uiStore.setLockout`.
  With explicit constructor injection each such edge is a constructor-parameter change
  rippling through the composition root.
- **Reachable outside React.** MobX stores react to each other (reactions over
  `router.activeRoute`) with no component in the loop — the thing hook-based DI can't do.
- **Late edges are cheap.** Adding a store-to-store dependency is a property access, so the
  graph grows without refactoring pressure. (This is also its cost — see below.)

## What it costs

1. **Everything can depend on everything.** The container type is the sum of all stores, so
   every store's type transitively references every other's. Coupling is invisible until it
   bites as a cycle (below) or as an untestable store (constructing one store's test double
   means faking the container).
2. **Half-constructed sibling access.** Field initializers run in order;
   `router = new WebRouterStore(this, …)` is declared *first*, receiving a container whose
   other fields don't exist yet. Today safe only because the router never touches `stores`
   in its constructor (and in fact never at all — see below); nothing enforces that. Any
   store that reads a sibling during construction works or crashes by field order.
3. **The cycles** — the concrete Jnana damage, worth tracing precisely.

## The two cycles, traced

**Value (module) cycle:**

```
globalStores.ts  →  routes.tsx           (router needs the route table)
routes.tsx       →  LoginPage.tsx, …     (routes need page components)
LoginPage.tsx    →  useStores.ts         (components need stores)
useStores.ts     →  globalStores.ts      (the hook needs the container — TYPE only)
```

Broken today by hand: `useStores.ts` exists as a separate module *solely* so the last edge
is `import type` (its header comment documents this). One careless value import re-closes
the loop.

**Type (inference) cycle:** `GlobalStoresContainer` includes
`router: WebRouterStore<typeof routes>` → `typeof routes` embeds every route component's
type → an *inferred* component type that reads `useStores()` embeds
`GlobalStoresContainer`. Broken today by discipline at each bite site: `LoginPage`
annotates its return (`: ReactNode`, with a comment explaining why), `pageScope` annotates
every `hook()` load's return. These fixes are correct but *distributed*: the invariant
"annotate anything between routes and stores" lives in comments, and violations surface as
opaque inference errors far from the cause.

Root cause in one sentence: **the route table needs components, components need stores,
and the container needs the route table only because the router is constructed inside
it.** The router-as-store is fine; the router-as-route-table-owner is what drags the
component universe into the store graph.

## Options

### Option A — router constructed outside; container holds a table-blind surface (recommended)

The key observation: rati already types navigation *without importing the routes value* —
`Link`'s `to` and `useRouteContext` read `RatiUserTypes['routes']` (the app's one
`declare module` augmentation), not the router's generic. Only `WebRouterStore<T>` itself
carries `typeof routes` as a generic. So give stores the same deal `Link` gets: a router
type whose `navigate`/`getPath` are typed off `UserRoutes` (the `RatiUserTypes` reader that
already exists in `router/route.tsx`) with **no type parameter**:

```ts
// rati — the store-facing surface; UserRoutes comes from the augmentation, not a generic
export interface AppRouter {                    // name TBD; see naming.md
    readonly activeRoute: ActiveRouteOf<UserRoutes> | null;
    readonly path: string;
    readonly state: unknown;
    navigate(to: NameToRoute<UserRoutes> | string, options?: NavigateOptions): void;
    replace(to: NameToRoute<UserRoutes> | string, options?: NavigateOptions): void;
    getPath(to: NameToRoute<UserRoutes> | string): string;
    setSearchParams(params: Record<string, string>): void;
    subscribe(onChange: () => void): () => void;   // for non-MobX consumers
}
// WebRouterStore<T> implements AppRouter — same object, narrower door.
```

App wiring — the container takes the router as a constructor argument; construction moves
to the entry module:

```ts
// globalStores.ts — imports neither routes.tsx nor any component, ever again
export class GlobalStoresContainer implements GlobalStores {
    constructor(public router: AppRouter) {}
    uiStore = new UIStore(this);
    authStore = new AuthStore(this);
    …
}

// main.tsx — the only module that sees both worlds
const router = new WebRouterStore(routes, { scrollRestoration: false });
export const rootStore = new RootStore(new GlobalStoresContainer(router));
```

Consequences:

- **Both cycles die structurally**, not by discipline. `globalStores.ts` has no edge to
  `routes.tsx` (value or type): `AppRouter` mentions only `UserRoutes`, which is ambient
  augmentation, not an import of the routes module. The `useStores.ts` module split and
  the boundary annotations (`LoginPage`, `pageScope`) become unnecessary — components and
  hook loads can infer freely because `GlobalStoresContainer` no longer embeds
  `typeof routes`. (`routes.tsx`'s own `declare module` is fine: TS resolves augmentation
  merging lazily; the historical failures were *inference* cycles, which this removes.)
- **Store code is unchanged.** `this.stores.router.activeRoute`,
  `this.stores.rootStores.router.getPath({ name: 'page', … })` — same expressions, still
  typed (via the augmentation), still reactive. Nothing about the container's ergonomics
  is given up; nested graphs (`WorkspaceStores`) inherit the fix for free.
- **Route params lose per-route narrowing in stores** — `activeRoute.routeParams` was
  already accessed defensively (`?.routeParams['space']`) so nothing regresses in
  practice, but `ActiveRouteOf<UserRoutes>` should still be a name-discriminated union so
  a store *can* narrow by `activeRoute.name`.
- rati-side cleanups that fall out: `WebRouterStore`'s `stores` constructor parameter is
  **already dead** (`getActiveRoute` names it `_stores` and never reads it) — drop it and
  the `extends GlobalStore<any>`, removing the framework-blessed bidirectional coupling
  that suggested `new WebRouterStore(this, …)` in the first place.

### Option B — keep `stores.router: WebRouterStore<typeof routes>`; manage cycles by rules

Today's state, made official: the hook lives in its own type-only module; every component
and hook load on a route-table path annotates its return type; a lint rule (or a
`madge`-style CI check) guards the value edge. Honest assessment: the workarounds are
individually small and already paid for, but the failure mode is bad — a missing
annotation resurfaces as an inscrutable inference error at a distance, and each new
route/scope re-risks it. Choose this only if the typed-params loss in Option A turns out
to matter, which current usage says it doesn't.

### Option C — dissolve the container; context-scoped graphs + explicit injection

The direction Jnana's per-identity layer already took (`WorkspaceStores`/`AccountStores`
behind `UserContext`/`AccountContext`, read via `hook()` loads in scopes): sub-graphs
provided by React context, stores receiving exactly the dependencies they use as
constructor arguments. Assessment: right for *scoped lifetimes* (per-identity, per-space —
where a container-of-everything can't express "this half rebuilds on login"), and scopes'
`hook()` DI makes consumption clean. But as a wholesale replacement it trades the
composition root's readability for constructor plumbing, and reactive store-to-store edges
(reactions over the router) still need the object graph, not a React context. Keep it as
the pattern for scoped sub-graphs — not a reason to abandon the root container for
app-lifetime singletons.

### Sub-option worth stealing regardless: lazy sibling accessors

For rare edges (or constructor-time safety), an accessor edge instead of a stored
container: `constructor(private getRouter: () => AppRouter)`. Removes the
half-constructed-sibling hazard for the stores that adopt it. Not proposed as the default —
it reintroduces per-edge wiring — but useful where a store touches a sibling during setup.

## Recommendation

1. **Adopt Option A.** Add the table-blind router surface to rati (typed off
   `UserRoutes`), drop `WebRouterStore`'s dead `stores` param and its `GlobalStore` base,
   and move router construction out of `GlobalStoresContainer` in Jnana. Delete the
   `useStores.ts` split-comment and the boundary annotations once green.
2. **Keep the container** for app-lifetime stores, with two written rules: nothing in the
   container module may import the route table or a component (now structurally true), and
   constructors must not *read* siblings — store the container, touch it lazily (or take a
   lazy accessor). If a hard init ordering ever appears, add an explicit two-phase
   `init()` rather than relying on field order.
3. **Keep Option C's shape for scoped sub-graphs** (per-identity/per-space), consumed via
   `hook()` loads — that split is already working well in Jnana and needs no framework
   change.
4. Rename the rati skeleton pieces together with this work — see
   [naming.md §6](../archive/directions-2026-07/naming.md) (`GlobalStore`'s fate: with the router decoupled, an empty
   base class that only stores `stores` is hardly worth its export; a
   `constructor(protected stores: T)` in app code says the same thing).
