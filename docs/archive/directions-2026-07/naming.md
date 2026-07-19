# Public API naming review

Everything was fair game (renames are still cheap — no external users). The bar, from the
design intent: plain English, mapped to concepts React devs already know, no coined terms.
Verdict scale: **keep** (good name), **rename** (better name exists), **restructure**
(the name is a symptom of an API shape question).

## Summary of recommended changes

| Current | Proposed | Why |
| --- | --- | --- |
| `prop()` / `Prop` | `input()` / `Input` | Ends the prop/param double-speak (§1) |
| `ScopeParams`, slot `params` | `ScopeInputs`, slot `inputs` | Same |
| `WebRouterStore` | `RouterStore` | "Web" is the injected history's business (§3) |
| `useWebRouter` | `useRouter` | Public in docs but marked `@internal` — resolve as public |
| `IslandHydrationProvider` etc. | `HydrationProvider` etc. via `rati/ssr` | Prefix carries no information; SSR wants its own entry (§4) |
| `indicatePendingAfterTimeoutMs` | `loadingDelayMs` (on the island) | Rehomed to mandala anyway (§5) |
| `RootStoreProvider`, `createUseStoresHook`, `GlobalStore(s)`… | rework with the container redesign | Incoherent cluster (§6) |
| `sleep` (public export) | remove from the barrel | Utility leakage |

Recommended **keeps** that were seriously questioned: `scope`, `island`, `route`, `load`,
`provide`, `hook`, `source`, `useScope`, `group`, `lazy`, `Navigate`, `Link`.

## 1. `prop()` — the one real inconsistency in the core vocabulary

The same concept has three names in the public API today: you *declare* it with `prop<T>()`,
you *type* it with `ScopeParams`, and the loading/error slots receive it as `params`.
Meanwhile "props" also means the opposite end — the resolved output (`ScopeProps`,
"components receive clean props"). A reader can't tell from the names that `Prop` and
`ScopeParams` describe the same thing while `Prop` and `ScopeProps` don't.

Recommendation: unify on **input** — the word the docs already reach for when explaining
the concept ("the head declares **inputs**"). That yields a clean three-word story:

- **inputs** — what a scope is given (`input<T>()`, `ScopeInputs`, slot `inputs`);
- **props** — what the component receives (`ScopeProps`) — resolved inputs + loads;
- **params** — router-owned URL segments only (`:pageId`, `ExtractRouteParams`), which
  *feed* a route scope's inputs but are not the scope's vocabulary.

```ts
export const pageScope = scope({
    space: input<string>(),
    pageId: input<Base64Uuid>(),
}).load({ … });

function PageError({ inputs, error }: { inputs: ScopeInputs<typeof pageScope>; … }) { … }
```

The conservative alternative — rename to `param()` and keep `ScopeParams` — fixes the
inconsistency too but overloads "param" for standalone islands, whose inputs arrive as
React props, not URL params. `input` is right for both faces.

## 2. Core vocabulary — questioned, kept

- **`scope`** — collides with lexical scope and DI-container "scopes", and doesn't by
  itself say *data*. Alternatives weighed: `data()` (too generic to build a vocabulary on —
  `useData(pageData)` says nothing), `spec`, `plan`, `recipe` (coined-term territory),
  `loader` (Remix baggage, and a scope is a value, not a function). "The scope of data this
  subtree gets" is literally what it is, `useScope` reads naturally, and Jnana's codebase
  shows the word wearing well (`pageScope`, `blockContentScope`). **Keep.**
- **`island`** — the serious collision: "islands architecture" (Astro) means interactive
  widgets in static HTML — close to the opposite emphasis. In rati's favor: the unit really
  is island-like (self-contained, resolves its own data, hydrates independently — the SSR
  dehydration is genuinely per-island), the word is evocative and established in Jnana
  ("blocks as islands"). Alternatives: `container` (the classic React term, but bland and
  now colliding with the stores container), `unit`, `view`, `pod` (coined). **Keep**, with
  one caveat: if SSG becomes a headline feature, revisit — in an SSG context readers *will*
  assume Astro semantics.
- **`load` / `provide` / `hook`** — all read as what they do; `provide` matches React's
  Provider vocabulary, `hook()` marks exactly "may call hooks". **Keep.**
- **`source`** — plain English for a live external store; `readySource` / `promiseSource` /
  `toSource` / `toSourceError` are a coherent family. **Keep.** (`SourceState` /
  `SourceError` / `NotAvailableError` — keep.)
- **`route` / `group`** — keep. The `route(path, name, component, options)` argument order
  is settled by usage; no change proposed.
- **`useScope` / `useOptionalScope`** — keep; the optional variant follows an established
  React naming pattern.

## 3. Router names

- **`WebRouterStore` → `RouterStore`.** Both qualifiers leak implementation: "Web" dates
  from a web-vs-memory split that the injectable `History` already absorbed
  (`createMemoryHistory` is an option, not a class), and there is no second router. Keeping
  `…Store` is fine — it *is* the external-store object, and plain `Router` is taken by the
  component. (The Vue-style alternative — class `Router`, component `RouterView` — renames
  two things to fix one; not worth it.)
- **`useWebRouter` → `useRouter`**, and make it officially public: it's marked `@internal`
  in source but is the documented way to navigate programmatically. The rename is the
  occasion to resolve that ambivalence.
- **`useRouteContext`** — slightly off: it returns what the route's **scope** provides, and
  "context" pulls attention to the mechanism (a React context) rather than the meaning.
  `useRouteScope(name)` would align it with `useScope` (same value, keyed by name instead
  of by scope object). Mild **rename** recommendation; keeping it is defensible since the
  value often *is* an app "context" object (`pageContext`).
- **`prepareRoute`** — fine for what it does (drive a router to its matched route for SSR);
  see §4 for where it should live.
- **`Link` / `ContextualLink` / `LinkContextProvider` / `useLinkContext` / `Navigate` /
  `lazy` / `PreloadableLazyComponent`** — keep. (`ContextualLink` is the only mouthful, but
  it says what it does and its audience is small.)
- **`RatiUserTypes`** — does its job; the ecosystem convention for this pattern is an
  interface named `Register` (TanStack Router, react-router 7). `RatiRegister` would ring
  familiar to people who know that convention, but `RatiUserTypes` is more self-explanatory
  to those who don't. **Keep** (weakly held).
- **`installScrollRestoration`** — keep; honest about being a side-effecting installer.

## 4. SSR / hydration names — restructure via a `rati/ssr` entry

`IslandHydrationProvider`, `createIslandHydrationCollector`, `IslandHydrationData`,
`IslandHydration` are long, and the `Island` prefix adds nothing — there is exactly one
hydration mechanism, and route islands use it too. Rather than shortening in place (naming
collisions in the main barrel), move the server-facing surface to a dedicated export:

```ts
import { HydrationProvider, createHydrationCollector, prepareRoute } from 'rati/ssr';
```

This groups everything a server entry needs (`prepareRoute` included — it's SSR-only),
keeps the main barrel client-focused, and the internal names in `mandala/hydration.tsx`
(`HydrationProvider`, `createHydrationCollector`) are already exactly right — the aliases
in `island/island.ts` disappear instead of being renamed. `HydrationProvider` does render
on the client too, so it stays re-exported from `rati` (same object, two doors), or the
client half keeps living in the main barrel — decide when building.

## 5. Data-layer names (`rati/mobx`, legacy)

Superseded wholesale by the companion package ([data-package.md](./data-package.md)) — its
vocabulary is `query` / `mutation` / `collection` / `pagedCollection` / `form` / `field`.
Specific legacy names, for the record:

- **`remoteData`** — the name says nothing about the debounce/race-guard behavior that is
  its actual identity. Dies with the migration.
- **`indicatePendingAfterTimeoutMs`** — the concept moves to the mandala as an island
  option; name it **`loadingDelayMs`** there (it delays the `loading` slot — the option
  name should point at the slot it modulates).
- **`ActiveData` / `ActiveApiData`** — Rails-flavored ("ActiveRecord") in a framework whose
  vocabulary is otherwise React-flavored. Not ported (see the data doc).
- **`remoteDataKey` / `responseKey`** — GraphQL-response pluckers; app-level, not framework
  vocabulary. Not ported.
- **`observableSource`** — exactly right (MobX observable → `Source`). **Keep**, wherever
  it ends up living.

## 6. Stores cluster — rename together with the redesign

The current set mixes three qualifiers for one axis: **Root**Store, **Global**Store(s),
**Generic**StoresContext / use**Generic**Stores — plus `createUseStoresHook`, a name about
hook-creation mechanics rather than meaning. Final names should follow the container
redesign ([stores-and-router.md](../../research/stores-and-router.md)); the direction:

- One noun for the container concept. `stores` is the word both apps already use —
  `StoresProvider` (for `RootStoreProvider`), `createStoresHook` (for
  `createUseStoresHook`).
- `GenericStoresContext` / `useGenericStores` shouldn't be public at all (internal plumbing
  for `Link`/`Router`; exporting them invites bypassing the typed hook).
- `GlobalStore` (the base class holding `stores`) is nearly empty and its fate is a design
  question, not a naming one — see the stores doc.
- `RootStore` itself: if it keeps only the readiness/init lifecycle, `AppStore` or keeping
  `RootStore` are both fine; decide after the redesign settles what it owns.

## 7. Barrel hygiene (minor)

- `sleep` is exported from the public barrel — a generic utility with no framework meaning.
  Remove from the public surface (keep internal).
- `navTrace` / `navTraceStart` / `navTraceEnabled` — debug tooling in the main barrel is
  fine (opt-in, framework-specific), but if a `rati/ssr` entry happens, a `rati/debug`
  entry could take these the same way. Cosmetic; no urgency.
