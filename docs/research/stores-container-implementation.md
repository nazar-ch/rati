# Stores container + router: Option A implementation plan

The deferred structural piece from [stores-and-router.md](./stores-and-router.md) (Option A)
plus the [naming.md §6](../archive/directions-2026-07/naming.md) stores-cluster renames. The mechanical renames
(input vocabulary, `RouterStore`/`useRouter`, the `rati/ssr` + `rati/debug` entries) already
landed; this is the one change that alters *shape*, not just names, so it wants its own
session. This doc is the plan for that session.

## Goal, in one line

Construct the router **outside** the container and hand the container a **table-blind**
router surface typed off the `RatiUserTypes` augmentation — killing both dependency cycles
structurally — then rename the stores cluster to a single `stores` vocabulary.

Everything `stores.router.activeRoute` / `stores.rootStores.router.getPath(…)` keeps working
verbatim (still typed via the augmentation, still reactive). No store-code ergonomics are
given up.

## Why (recap of the two cycles)

- **Value cycle:** `globalStores.ts → routes.tsx → components → useStores.ts → (type) globalStores.ts`.
  Broken today only by discipline — `useStores.ts` exists as a separate module *solely* so the
  last edge is `import type`. One careless value import re-closes it.
- **Type cycle:** `GlobalStoresContainer` embeds `router: RouterStore<typeof routes>` →
  `typeof routes` embeds every route component's type → a component that reads `useStores()`
  embeds `GlobalStoresContainer`. Broken today by distributed annotations (`LoginPage`'s
  `: ReactNode`, every `pageScope` `hook()` load's return type).

Root cause: **the container references the route table only because the router is constructed
inside it.** Move construction out and both cycles disappear — the annotations and the
`useStores.ts` split become unnecessary.

## rati changes

### 1. Add the table-blind router surface (additive, non-breaking)

In `router/` (e.g. `router/appRouter.ts` or fold into `store.ts`): an interface whose
`navigate`/`getPath`/… are typed off `UserRoutes` (the `RatiUserTypes` reader already in
`router/route.tsx`), **with no type parameter**:

```ts
export interface AppRouter {                    // NAME TBD — see naming.md §3/§6
    readonly activeRoute: ActiveRouteOf<UserRoutes> | null;
    readonly path: string;
    readonly state: unknown;
    navigate(to: NameToRoute<UserRoutes> | string, options?: NavigateOptions): void;
    replace(to: NameToRoute<UserRoutes> | string, options?: NavigateOptions): void;
    getPath(to: NameToRoute<UserRoutes> | string): string;
    setSearchParams(params: Record<string, string>, options?: { mode?: 'push' | 'replace' }): void;
    subscribe(onChange: () => void): () => void;   // for non-MobX / uSES consumers
    readonly search: string;
    readonly hash: string;
    readonly searchParams: URLSearchParams;
    isPath(path: string): boolean;
    preloadRoute(path: string): Promise<unknown> | undefined;
}
```

- Match the surface against the **current public `RouterStore` methods** so `RouterStore<T>
  implements AppRouter` type-checks with no changes to method bodies (audit: `navigate`,
  `replace`, `getPath`, `setSearchParams`, `subscribe`/`getSnapshot`, `path`/`search`/`hash`/
  `searchParams`/`state`, `isPath`, `preloadRoute`, `activeRoute`, `routes`, `dispose`,
  `pendingNavigation`). Decide which belong on the narrow interface vs stay `RouterStore`-only
  (SSR-only bits like `pendingNavigation` can stay off `AppRouter`).
- `ActiveRouteOf<UserRoutes>` should be a **name-discriminated union** so a store *can* narrow
  by `activeRoute.name` (today `routeParams` is read defensively `?.routeParams['space']`, so
  nothing regresses, but the union is the right shape).
- `NavigateOptions` = the existing `{ keepCurrentRoute?; state? }`.

### 2. `RouterStore<T> implements AppRouter`

Same object, narrower door. Should be zero body changes if the interface is derived from the
current methods.

### 3. Drop the dead `stores` param and the `GlobalStore` base

`RouterStore`'s constructor `stores` param is **already dead** — `getActiveRoute` names it
`_stores` and never reads it, and the class never touches `this.stores`. Change:

```ts
// before
export class RouterStore<T…> extends GlobalStore<any> {
    constructor(stores: any, public routes: T, options: RouterStoreOptions = {}) { super(stores); … }
// after
export class RouterStore<T…> implements AppRouter {
    constructor(public routes: T, options: RouterStoreOptions = {}) { … }
```

This removes the framework-blessed bidirectional coupling that suggested
`new RouterStore(this, …)` in the first place. **Breaking** — every construction site drops
its first arg (rati tests + examples in the same commit; Jnana + website below).

### 4. `GlobalStores.router` becomes table-blind

```ts
export interface GlobalStores {   // → maybe `Stores`? see naming
    router?: AppRouter;           // was RouterStore
}
```

`useRouter()` still narrows via `instanceof RouterStore` (RouterStore implements AppRouter),
so its body is unchanged.

### 5. naming.md §6 — the stores cluster

- `RootStoreProvider` → **`StoresProvider`**.
- `createUseStoresHook` → **`createStoresHook`**.
- `GenericStoresContext` / `useGenericStores` → **make internal** (drop from the barrel;
  they're plumbing for `Link`/`Router`, and exporting them invites bypassing the typed hook).
- `GlobalStores` interface → the container noun is `stores`; consider **`Stores`**.
- `RootStore`: keep, or `AppStore` — decide once it's clear it only owns the readiness/init
  lifecycle. Low stakes; keeping `RootStore` is fine.
- `GlobalStore` base class fate (see below) — a **decision**, not a mechanical rename.

### 6. Barrel + docs

Update `main.ts`, `docs/current/public/guide.md` + `reference.md` (app-setup snippet: `new RouterStore(routes)`,
`StoresProvider`, `createStoresHook`), `docs/current/internals.md`, `CLAUDE.md`, and the two examples.

## Jnana changes

### 1. Move router construction out of the container

`globalStores.ts` stops importing `routes` (kills the value edge). The container takes the
router as a constructor arg:

```ts
// globalStores.ts — imports neither routes.tsx nor any component
export class GlobalStoresContainer implements Stores {
    constructor(public router: AppRouter) {}
    uiStore = new UIStore(this);
    authStore = new AuthStore(this);
    keyboardStore = new KeyboardStore();
    bootStore = new BootStore();
}
```

The router + rootStore construction and the `bootStore.start(...)` side-effect move to a new
**composition module** (the only place that sees both routes and the container) — e.g.
`frontend/src/rootStore.ts`:

```ts
import { RootStore, RouterStore } from 'rati';
import { GlobalStoresContainer } from '#/globalStores';
import { routes } from '#/routes';
import { sessionHydrationSource } from '#/common/app-shell/boot';

const router = new RouterStore(routes, { scrollRestoration: false });
export const rootStore = new RootStore(new GlobalStoresContainer(router));
rootStore.stores.bootStore.start([sessionHydrationSource(rootStore.stores.authStore)]);
```

`App.tsx` imports `rootStore` from `#/rootStore` instead of `#/globalStores`. (`App.tsx` is
today the only value-importer of `rootStore`.) Keep the seed-before-arm `bootStore.start`
ordering at module scope — do **not** move it into a React effect.

### 2. Drop the now-unnecessary workarounds (the payoff)

- Delete `useStores.ts`'s split-comment; the module can stay (the hook still wants the
  container *type*), but it's no longer load-bearing — verify by confirming a value import of
  `#/globalStores` from a component no longer cycles.
- Remove the boundary annotations that existed only to break the type cycle and confirm
  inference is now free:
  - `LoginPage.tsx` — the `: ReactNode` return annotation + its explaining comment.
  - `pageScope.tsx` — the `hook((): ResourcesStore => …)` / `(): SpacesStore =>` / etc. return
    annotations (they can become `hook(() => useUserStores().resourcesStore)`).
  - Update `.claude/frontend-architecture.md` line ~25 ("DI: hook((): T => …) with an
    annotated return type — avoids the globalStores→routes→scope type cycle"): the cycle is
    gone, so the annotation is optional.

### 3. Constructor-site + §6 rename adoption

- Drop the first arg at every `new RouterStore(this|{}, routes, …)` site (globalStores → the
  new module; `website/frontend/src/create-app.tsx`; rati examples).
- `RootStoreProvider` → `StoresProvider` in `App.tsx`; `createUseStoresHook` →
  `createStoresHook` in `useStores.ts`.
- `SpaceTreeContextStore`'s `private router: RouterStore` may narrow to `AppRouter` (optional).

### 4. `GlobalStore` base class — decide

10 Jnana stores `extends GlobalStore<T>` (`AuthStore`, `UIStore`, `SpacesStore`, `AdminStore`,
`OfflineFlushStore`, `SpaceSyncStore`, `SpacesManagementStore`, `ResourcesStore`,
`PreferencesStore`, `ImageUrlStore`). With the router decoupled, `GlobalStore` is a near-empty
base that only stores `stores` — naming.md §6 and stores-and-router.md rec #4 note a
`constructor(protected stores: T)` in app code says the same thing.

- **Option (keep):** leave `GlobalStore` exported and the 10 extenders untouched. Lowest risk;
  the base is harmless. Recommended default unless the session explicitly wants the cleanup.
- **Option (drop):** remove the export, replace each `extends GlobalStore<T>` with an inline
  `constructor(protected stores: T) {}`. Mechanical but touches 10 files across the identity
  sub-graphs (`WorkspaceStores`/`AccountStores`), so it's the churny part — do it as its own
  commit if chosen.

## Sequencing (keep both repos green at each step)

1. **rati, additive:** add `AppRouter`; `RouterStore implements AppRouter`; change
   `GlobalStores.router` to `AppRouter`. Non-breaking. Verify rati + examples green.
2. **rati, breaking ctor:** drop the dead `stores` param + `GlobalStore` base from
   `RouterStore`; update rati tests + examples in the same commit.
3. **jnana, lockstep:** the new composition module + container ctor + drop first-arg call
   sites + delete boundary annotations. Verify frontend typecheck + full test suite + website.
4. **§6 renames:** `StoresProvider` / `createStoresHook` / internalize
   `GenericStoresContext`+`useGenericStores` / (opt) `Stores` / (opt) `GlobalStore` removal.
   Pure renames, mechanical, last.

Steps 2–3 are the only ones that must land together (they share the `RouterStore` constructor
signature); do them against local rati source (tsconfig alias) as this session did.

## Risks / gotchas

- **Field-init order:** container fields initialize in declaration order; injecting `router`
  via the ctor arg means `this.router` exists for every field initializer. Keep the written
  rule: constructors must **not read siblings** during construction (store the container,
  touch it lazily) — or take a lazy accessor for the rare edge (the "lazy sibling accessor"
  sub-option). If a hard init ordering ever appears, add an explicit two-phase `init()` rather
  than relying on field order.
- **Augmentation, not import:** `routes.tsx`'s `declare module 'rati'` stays; TS resolves
  augmentation merging lazily, so `AppRouter` mentioning `UserRoutes` is ambient, not a value
  edge — the historical failures were *inference* cycles, which this removes.
- **SSR-only surface:** `pendingNavigation` (awaited by the SSR `prepareRoute` path) and
  `routes`/`dispose` are `RouterStore`-level; decide whether `AppRouter` needs them or callers
  keep the concrete type where they touch SSR bits.
- **Website + examples:** they construct routers too — update in lockstep with step 2.

## Verification

`rati#typecheck` + `#typecheck:test` + `#test` (192) + `vp lint` + `vp build`; jnana
`@jnana/frontend#typecheck` + full test suite + `@jnana/website-frontend#typecheck`, against
local rati via the tsconfig alias (uncomment + the committed React `dedupe`). Explicitly
confirm the **removed** annotations (`LoginPage`, `pageScope` hooks) don't reintroduce
inference errors — that's the proof the cycle died structurally.

## Open decisions for the session

- `AppRouter` name (naming.md §3/§6 leaves it TBD).
- `GlobalStore` base: keep (recommended) vs drop-and-inline (10 files).
- `RootStore` → `AppStore` vs keep (`RootStore` is fine).
- `GlobalStores` interface → `Stores`?
- Whether `SpaceTreeContextStore` (and other router-holding stores) narrow to `AppRouter`.
- Adopt the lazy-sibling-accessor sub-option, or just keep the "don't read siblings in
  constructors" rule.

## Out of scope (stays as-is)

Option C's context-scoped sub-graphs (`WorkspaceStores`/`AccountStores` behind
`UserContext`/`AccountContext`, consumed via `hook()` loads) already work well and need no
framework change — keep them for per-identity/per-space lifetimes.
