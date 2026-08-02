# CLAUDE.md

rati is a small, custom TypeScript frontend framework for **React**, built and
evolved alongside Jnana (the app at `~/Sites/jnana`) to serve its needs — prioritizing
simplicity, end-to-end type safety, and developer experience. Jnana consumes rati's source
directly (via the `rati-dev` export condition) and drives its design.

Yarn-workspaces monorepo: `packages/rati` (the published `rati` package) plus
`examples/{demo,ssr}` (dev/test apps). Workspace names: `rati`, `demo`, `ssr-demo`.

The workflow every jnana-kit consumer shares — branch → gate → PR → push, work items and
findings, the env-feedback boundary, the toolchain, style, memory, the seams — is already in
your session from user scope (`$JNANA_KIT_HOME/plugin/claude-md/base.txt`), and the doctrine
behind it is read from `$JNANA_KIT_HOME/plugin/docs/`. Below is only what is rati's.

## Canonical docs — read these first

They are the source of truth and are kept current. Keep them in sync when you change
behavior they describe.

- `docs/current/public/` — the **guide** + **reference**: the public API + mental model
  (scope / input / load / provide / hook / data / source / island / route / useScope /
  useScopeControls), app setup, routing, SSR. The website renders these — they are the
  main station for anything user-facing; new public surface documents here, nowhere else.
- `docs/current/internals.md` — contributor internals only: source layout, the `mandala`
  engine, the resolver/refresh machinery, lifecycle/teardown, channels, SSR dehydration,
  testing pointers, toolchain.
- `docs/research/` — deferred features, design directions, testing strategy.
- `docs/planned/` — committed efforts: an effort `README.md` (framing, decisions,
  narrative item map), an optional `plan.md` (batches + grading), and one **work-item
  record** per item under `issues/<ID>-<slug>.md`. Conventions below.
- `docs/current/RELEASING.md` — release process; `docs/planned/website/website-plan.md` — the
  public site.

## Mental model

A **scope** declares *which data go where* (inputs via `input<T>()`, then `.load({…})`
levels resolved as a visible waterfall). An **island** mounts a scope — pairs it with a
component plus loading/error slots, resolves the data, and provides the resolved props to
its subtree. A **route** is an island bound to a URL. Components receive clean,
fully-resolved props — no loading-state juggling.

```
scope({ inputs }).load({ data }).provide(factory?)   →  a Scope (a plain value)
island({ scope, component, loading, error })         →  a component
route(path, name, component, { scope, … })           →  the same, on a URL
useScope(scope)                                       →  read what it provides, below
```

Design intent (the "why"): the author dislikes hook-style data loading (react-query/SWR)
that makes components manage loading states and re-declare types. rati resolves declarative
typed specs into fully-loaded props, with types inferred end-to-end from backend types.
Resolution is all-or-nothing — a half-resolved bag is incoherent. Naming is deliberately
plain English mapped to concepts React devs already know; **avoid coining new terms** in
the public API (the internal engine name `mandala` is the lone exception, and stays
internal — callers only ever see `island`/`route`).

## Workflow

- **The gate is `yarn ci`, not just the kit runner.** The whole gate in one command is
  `yarn ci` (`scripts/ci.ts` —
  fmt / lint / typecheck / test / deep fuzz / build, aggregated; a subset by stage name,
  `FUZZ_RUNS=…` to deepen the randomized stage). It is the stand-in for hosted CI. The
  **pre-push gate** is `.claude/kit.json` `verify` — the fast subset
  `yarn ci fmt lint typecheck test` (it skips the 500-run deep fuzz and the example builds);
  run full `yarn ci` yourself before a release or when you touch the mandala engine or the
  packaging/build. A run covering that subset leaves the kit's run stamp, so the Stop hook
  nudges a session that pushes without one; a narrower `yarn ci fmt` deliberately leaves none.
- **Match the existing plain-imperative commit history** when you write a subject.
- Keep `docs/*.md` in sync with behavior changes.
- **Consumer-visible change ⇒ a [CHANGELOG.md](CHANGELOG.md) `## Unreleased` bullet in the
  same commit.** Anything a consumer must or may act on: a removal or rename (with its
  replacement), a behavior fix they were working around, new public surface. A release only
  retitles that section, so an entry missed here is an entry that never gets written —
  0.7.0 shipped with none, and the consumer adopting it read `git log` instead. Purely
  internal work adds nothing.
- **rati's id prefixes:** **DATA** (the `rati/data` package), **DX** (testing + developer
  experience), **IMP** (improvement review), **REV** (production review), **SI**
  (scope/island). Findings land in `docs/backlog/findings/issues/`.

## Restricted actions

- **Don't run `vp lint --fix` blindly** — `no-unnecessary-type-assertion`'s autofix breaks the
  typecheck, which is why that rule is off here and tsc is the authoritative gate; the detail
  is `$JNANA_KIT_HOME/plugin/docs/toolchain/lint.md`.

## Toolchain — Vite+ (`vp`)

Type-checking is **tsc** run from the workspace root as `yarn run -T tsc`, and lint/format
config lives in the root `vite.config.ts` `lint`/`fmt` blocks.

```bash
vp run rati#build         # vite lib bundle + tsc emits dist/*.d.ts
vp run rati#typecheck     # tsc --noEmit (src); rati#typecheck:test for the test tree
vp run rati#test          # Vitest (runtime + *.test-d.ts type tests via the tsc checker)
```

## Source layout (`packages/rati/src`)

Public barrel: `main.ts` (the only entry; the published surface). Internals — see
`docs/current/internals.md §Source layout`:

- `scope/` — `scope.ts` (the declarative spec builder) and `source.ts` (the Source state
  machine: pending → ready/error).
- `mandala/` — the engine ("one engine, two faces"): `mandala.tsx`, `resolver.tsx` (the
  per-level Step tree), `channel.ts` (the scope-keyed value channel + `useScope`),
  `boundary.tsx`, `hydration.tsx` (SSR). Internal.
- `island/island.ts` — the public `island()` wrapper.
- `router/` — `route.tsx`, `store.ts` (the internal RouterStore), `router.ts` (the public
  `Router` interface), `createRouter`, `RouterProvider` (context + `useRouter`),
  `RouterOutlet`/`Link`/`Navigate`, `useRouteContext`, `prepareRoute`, `history`,
  `scrollRestoration`, `lazy`.
- `data/` — the `rati/data` entry: the MobX-shaped data primitives (`query`, `collection`,
  `reconciled`, `mutation`, `form`/`field` + the validator kit), successor of the deleted legacy layer
  (`remoteData`/`ActiveData`) and Jnana's `FetchStore` family. Experimental; design record:
  `docs/archive/directions-2026-07/data-package.md`; pending extraction to a companion
  package. Plain observable objects from factories — no decorators, no classes.
- `mobx/` — the `rati/mobx` entry: `observableSource` (a MobX-derivation→`Source` adapter).
  Together with `data/`, the only code that touches MobX (an optional peer dep).
- `ssr/` — the `rati/ssr` entry: the server-facing surface (`HydrationProvider`,
  `createHydrationCollector`, `prepareRoute` + the `Hydration`/`HydrationData` types),
  re-exported from `mandala/hydration.tsx` and `router/prepareRoute.ts`; plus `renderApp`
  (the per-request loop) and `html.ts` — the template/whole-document assembly the two
  servers below share, internal.
- `vite/` — the `rati/vite` entry: the plugin (dev serving + the two-environment build +
  `virtual:rati/assets`). Runs in the Vite process; nothing here reaches the browser.
- `server/` — the `rati/server` entry: `createRequestHandler` (fetch-shaped, the result
  kinds → HTTP + the CSR fallback) and `serve` (the `node:http` adapter, static files +
  the MIME table). Production only — dev is the plugin's.
- `debug/index.ts` — the `rati/debug` entry: the two opt-in console tracers — `navTrace`
  (from `util/navTrace.ts`) and `dataTrace` (from `util/dataTrace.ts`, island resolution).
- `types/` — `generic.ts`. `util/` — `utils.ts`.

## Key patterns

- **Reactivity = `useSyncExternalStore`.** Core is MobX-free: a `Source` is a
  `subscribe`/`getSnapshot` pair, the router is a plain external store, and components
  read both through uSES (no `observer`). Optional MobX bindings (`observableSource`) live in
  `rati/mobx`.
- **No stores container.** rati ships no store skeleton (`RootStore`/`GlobalStore` are
  gone) — an app's store graph is app code behind its own context. The router is provided
  on its own (`createRouter` → `RouterProvider` → `useRouter`), and the `Router` type is
  table-blind (typed off the `RatiUserTypes` augmentation), so app containers hold it
  without importing the route table.
- **No decorators anywhere.** The legacy decorator-using `data/` layer is gone, and the
  Babel lowering (`@babel/plugin-proposal-decorators`) went with it — the toolchain is
  pure oxc. `rati/data` models state as plain observable objects from factories.
- **`rati-dev` export condition** exposes `src/main.ts` so consumers (Jnana, the examples)
  type-check and bundle rati's *source* in dev — edits are picked up with no build. The
  published `import`/`types` conditions point at `dist/`.
- **Lint policy** (root `vite.config.ts`, derived from Jnana, adapted for a generics-heavy
  framework): the type-machinery rules — `no-explicit-any`, `no-non-null-assertion`,
  `no-empty-object-type`, `no-redundant-type-constituents` — are **`warn`** (they fire on
  intentional generic constraints like `Scope<any>`, the `RatiUserTypes {}` augmentation
  interface, `arr[i]!`). `no-unnecessary-type-assertion` is **off** (see Restricted
  actions). Everything else is strict; React rules apply repo-wide.
- **oxfmt does not format Markdown** (it corrupts snake_case next to emphasis) — `**/*.md`
  is excluded in the `fmt` block; edit docs by hand.
- rati uses **relative imports** (no `#` path alias), and no barrel beyond `main.ts`.
- Keep the *why* comments and the `console.*` you didn't write.

## Examples — current status

`examples/demo` and `examples/ssr` are on the current `scope`/`island`/`route` API and both
typecheck, build, and lint — so `vp lint` is green repo-wide (the `rati` package emits only
the intentional type-machinery warnings). `demo` is a client-only SPA showing plain route
components, route params, and `scope().load(…)` waterfalls (incl. a store class). `ssr` is a
server-rendered **feature gallery** — a page per concept (async loads + dehydration, an
`input`→`hook`→dependent waterfall, the `useRouteContext` value channel, a MobX store as a
class load, a `Source`-backed live clock, an error-slot + `retry`, a `lazy()` route whose
chunk the built page preloads, and a route whose `wrapper` throws on the server to show the
CSR fallback), each foregrounding its server/client behavior. It has no server and no build
script of its own: `rati/vite` runs dev and both build environments (`vp dev` / `vp build`),
so `index.html` is a plain shell — no `<script>`, no build input — and `serve.ts` is ~12
lines over `rati/server` (`vp run ssr-demo#start`, after `vp run rati#build` — plain node
resolves the published entry, not the `rati-dev` source condition).

The SSR mechanism: a route's scope is an island that resolves at render time, so the server
uses `react-dom/static` `prerender` (not `renderToString`, which can't await the island's
Suspense) and dehydrates the resolved promise values through `HydrationProvider` (from the
`rati/ssr` entry); the
client feeds them back so it rehydrates without re-running the loads. Two consequences the
gallery leans on: server-only data must be an **async** load to be dehydrated (a sync load
isn't serialized and would mismatch on hydration), and a `Source` stays *pending* under SSR
(its `attach` runs from an effect, which `prerender` doesn't run) — so source-backed pages
ship their loading slot in the HTML and come alive only after hydration.

## Memory

Where a note lands here: the canonical docs above are the stations, and point-in-time status
goes to the owning work-item record — never to a `.claude/` note that then has to be kept in
sync with both.
