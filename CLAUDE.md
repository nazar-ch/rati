# CLAUDE.md

rati is a small, custom TypeScript frontend framework for **React**, built and
evolved alongside Jnana (the app at `~/Sites/jnana`) to serve its needs — prioritizing
simplicity, end-to-end type safety, and developer experience. Jnana consumes rati's source
directly (via the `rati-dev` export condition) and drives its design.

Yarn-workspaces monorepo: `packages/rati` (the published `rati` package) plus
`examples/{demo,ssr}` (dev/test apps). Workspace names: `rati`, `demo`, `ssr-demo`.

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
- `docs/current/RELEASING.md` — release process; `docs/website-plan.md` — the public site.

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

- Clarify and ask for information you need.
- Run commands from the repo root; target a workspace with `vp run <pkg>#<script>`
  (e.g. `vp run rati#typecheck`).
- Verify changes with **type-check and lint**: `vp run rati#typecheck` (tsgo — the
  authoritative type gate) **and** `vp lint`. `vp check` runs format + lint (no type-check).
- The whole gate in one command: `yarn ci` (`scripts/ci.ts` — fmt / lint / typecheck /
  test / deep fuzz / build, aggregated; a subset by stage name, `FUZZ_RUNS=…` to deepen
  the randomized stage). It is the stand-in for hosted CI — run it before handing work over.
- Create atomic commits as you work, on the current branch. **Conventional Commits style is
  forbidden** — match the existing history (plain imperative sentences).
- Keep `docs/*.md` in sync with behavior changes.
- Doc links: cross-tree references are repo-root-relative (`docs/current/internals.md`), never
  `../` — relative depth breaks silently when a doc moves and can't be grepped from the target
  side. Within-directory relative links are fine (they move with their folder). Cross-repo refs
  use a scheme (`jnana:///docs/README.md`); backticked paths are deliberate non-links. Same
  convention as jnana's docs/README.md "Doc links" (gated there by check-doc-links.ts).

## Work items

Tasks and issues are one primitive — a **work item**: one file per item,
`docs/planned/<effort>/issues/<ID>-<slug>.md` (jnana's convention; kept deliberately
compatible with it, minus the `tools/issues.ts` tooling rati doesn't have).

- **Anatomy** — a leading `---` frontmatter block, then the title `# <ID> — <imperative
  summary>`. The block holds `area:`, `needs:` (ids this depends on), `status:`
  (`open`/`done`), `disposition:` — simple `key: value` raw-string lines, one line each
  (not full YAML: no quoting, no nesting, no wrapped continuations). It sits *above* the
  title so a Markdown formatter treats it as opaque. Then the body: problem, why it
  matters, links — written for a future session with none of your context.
- **Assignable = the executable sections are present**: `## Scope` (numbered steps),
  `## Boundaries` (what not to touch), `## Verify` (the recipe proving it done). Without
  them a record is filed analysis awaiting planning.
- **Status is the record's own `status:` field**, read from whatever branch you are on —
  never derived from git log, never a table in a README. Born `open`; the finishing commit
  flips it to `done`, and **that edit is the whole close ceremony** (no `Closes:` trailer,
  no "(done)" title, no ✅). A commit closing several items flips each. Reopen = flip back.
  Partial progress goes in the record's **text**, not a third state.
- **Decisions stay separate**, in `disposition:`, with a dated line in the body saying why.
  A disposition leading with `accepted` / `adopted` / `deferred` / `dissolved` / `retracted`
  / `watch` / `wontfix` **holds** the item out of default views; any other leading word
  (rati's records mostly lead with `cut …`) reads as a note and leaves the record live.
- **Prefix commit subjects with the id**: `SI-03: <what>`. Never hand-maintain a list or
  status table of items in any doc — effort READMEs carry narrative and ordering only.

## Restricted actions

- **Don't publish.** `scripts/release.sh` (the `release` script) bumps the version, tags,
  and runs `yarn npm publish`. Never run it — releasing is the maintainer's call (see
  `docs/current/RELEASING.md`). `--dry-run` is the only safe form, and still: leave it to
  the user.
- **Don't run `vp lint --fix` blindly.** oxlint's `no-unnecessary-type-assertion` autofix
  disagrees with tsgo (it ignores `noUncheckedIndexedAccess` and strips load-bearing
  generic casts), so it can break the typecheck — that rule is off in the config for this
  reason, and tsgo is the authoritative gate. Other autofixes (e.g. consistent-type-imports)
  are safe.
- Don't remove `console.*` or commented-out code; preserve comments that explain *why*
  (update/amend your own when reasonable). Offer fixes if they touch the current scope.

## Toolchain — Vite+ (`vp`)

rati runs on **Vite+** (the `vp` CLI bundling Vite/Rolldown, Vitest, oxlint, oxfmt). All
lint/format config lives in the root `vite.config.ts` `lint`/`fmt` blocks — there is no
eslint/prettier. Node is pinned to **26** via `devEngines.runtime`. Type-checking is
**tsgo** (`@typescript/native-preview`, the TypeScript 7 native compiler) — there is no
`typescript` dependency.

```bash
vp run rati#build         # vite lib bundle + tsgo emits dist/*.d.ts
vp run rati#typecheck     # tsgo --noEmit (src); rati#typecheck:test for the test tree
vp run rati#test          # Vitest (runtime + *.test-d.ts type tests via the tsgo checker)
vp lint                   # oxlint   (vp lint --type-aware for the type-aware pass)
vp fmt                    # oxfmt
vp check                  # fmt + lint (NOT type-check)
```

Pre-commit hooks (`.vite-hooks/` + `prepare: vp config`) run `vp staged` (fmt + lint on the
staged files) on every commit.

## Source layout (`packages/rati/src`)

Public barrel: `main.ts` (the only entry; the published surface). Internals — see
`docs/current/internals.md §Source layout`:

- `scope/` — `scope.ts` (the declarative spec builder) and `source.ts` (the Source state
  machine: pending → ready/error).
- `mandala/` — the engine ("one engine, two faces"): `mandala.tsx`, `resolver.tsx` (the
  per-level Step tree), `channel.ts` (the scope-keyed value channel + `useScope`),
  `boundary.tsx`, `hydration.tsx` (SSR). Internal.
- `island/island.ts` — the public `island()` wrapper.
- `router/` — `route.tsx`, `store.ts` (RouterStore), `Router`/`Link`/`Navigate`,
  `useRouteContext`, `prepareRoute`, `history`, `scrollRestoration`, `lazy`.
- `data/` — the `rati/data` entry: the MobX-shaped data primitives (`query`, `collection`,
  `mutation`, `form`/`field` + the validator kit), successor of the deleted legacy layer
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
- `stores/` — `RootStore`, `GlobalStore`. `types/` — `generic.ts`. `util/` — `utils.ts`.

## Key patterns

- **Reactivity = `useSyncExternalStore`.** Core is MobX-free: a `Source` is a
  `subscribe`/`getSnapshot` pair, `RouterStore` is a plain external store, and components
  read both through uSES (no `observer`). Optional MobX bindings (`observableSource`) live in
  `rati/mobx`.
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
- rati uses **relative imports** (no `#` path alias).

## Style

- One React component per file; prefer composable components and short files.
- Import order is oxfmt-enforced (see `fmt.importOrder`). No barrel exports beyond `main.ts`.
- No excessive variable shortening (`rows.map((row) => …)`, not `(r) => …`).

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

**Known**: the gallery's `/counter` renders blank in any *production* build (dev is fine).
It is not the example: `is.class` (`util/utils.ts`) detects a class by reading
`Function.prototype.toString`, and minification rewrites `class CounterStore {…}` into an
anonymous `class{…}`, so the class load is called without `new`. Pre-dates the server kit.

The SSR mechanism: a route's scope is an island that resolves at render time, so the server
uses `react-dom/static` `prerender` (not `renderToString`, which can't await the island's
Suspense) and dehydrates the resolved promise values through `HydrationProvider` (from the
`rati/ssr` entry); the
client feeds them back so it rehydrates without re-running the loads. Two consequences the
gallery leans on: server-only data must be an **async** load to be dehydrated (a sync load
isn't serialized and would mismatch on hydration), and a `Source` stays *pending* under SSR
(its `attach` runs from an effect, which `prerender` doesn't run) — so source-backed pages
ship their loading slot in the HTML and come alive only after hydration.
