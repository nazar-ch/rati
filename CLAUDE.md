# CLAUDE.md

rati is a small, custom TypeScript frontend framework for **React**, built and evolved alongside
Jnana to serve its needs — prioritizing simplicity, end-to-end type safety, and developer
experience. Jnana consumes rati's source directly (via the `rati-dev` export condition) and drives
its design.

Yarn-workspaces monorepo: `packages/rati` (the published `rati` package) plus `examples/{demo,ssr}`
(dev/test apps). Workspace names: `rati`, `demo`, `ssr-demo`.

The workflow every jnana-kit consumer shares — branch → gate → PR → push, work items and findings,
the env-feedback boundary, the toolchain, style, memory, the seams — is already in your session from
user scope ($JNANA_KIT_HOME/plugin/claude-md/base.md), with the doctrine behind it read from
$JNANA_KIT_HOME/plugin/docs/. This file carries only what is rati's.

## Canonical docs — read these first

The stations, and the source of truth for what each covers.

- docs/current/public/ — the **guide** + **reference**: the public API and mental model, app setup,
  routing, SSR, rendered by the website.
- docs/current/internals.md — contributor internals: source layout, the `mandala` engine, the
  resolver/refresh machinery, lifecycle/teardown, channels, SSR dehydration, testing, toolchain.
- docs/research/ — deferred features, design directions, testing strategy.
- docs/planned/ — committed efforts: an effort `README.md` (framing, decisions, narrative item map),
  an optional `plan.md` (batches + grading), and one **work-item record** per item under
  `issues/<ID>-<slug>.md`.
- docs/current/RELEASING.md — the release process; docs/planned/website/website-plan.md — the public
  site.
- New public surface documents in docs/current/public/ and nowhere else — that tree is what the
  website renders.

## Mental model

A **scope** declares *which data go where* (inputs via `input<T>()`, then `.load({…})` levels
resolved as a visible waterfall). An **island** mounts a scope — pairs it with a component plus
loading/error slots, resolves the data, and provides the resolved props to its subtree. A **route**
is an island bound to a URL. Components receive clean, fully-resolved props — no loading-state
juggling.

```
scope({ inputs }).load({ data }).provide(factory?)   →  a Scope (a plain value)
island({ scope, component, loading, error })         →  a component
route(path, name, component, { scope, … })           →  the same, on a URL
useScope(scope)                                       →  read what it provides, below
```

Design intent (the "why"): the author dislikes hook-style data loading (react-query/SWR) that makes
components manage loading states and re-declare types. rati resolves declarative typed specs into
fully-loaded props, with types inferred end-to-end from backend types. Resolution is all-or-nothing
— a half-resolved bag is incoherent. Naming is deliberately plain English mapped to concepts React
devs already know; **avoid coining new terms** in the public API (the internal engine name `mandala`
is the lone exception, and stays internal — callers only ever see `island`/`route`).

## Workflow

- **The gate is the kit's standard battery**, named by `.claude/kit.json` `verify` and run from the
  repo root as that field's command — fmt, lint, typecheck, Markdown, doc- and comment-links, the
  control-byte scan, the `@jnana-app/kit` conformance checks, the record gate and the full Vitest
  suite. rati declares **no** `verify:*` scripts and must not gain any: the battery is the list.
- **`yarn ci` is no longer the gate** — it is the release ritual, and it now holds only the two
  things the battery does not run: `fuzz` (the randomized suites at `FUZZ_RUNS=500`, default 2000
  via the env) and `build` (library bundle + d.ts, then both examples). **Run `yarn ci` before a
  release, and after touching the mandala engine or the packaging/build.**
- **Match the existing plain-imperative commit history** when you write a subject.
- Keep `docs/*.md` in sync with the behavior they describe.
- **A consumer-visible change takes a CHANGELOG.md `## Unreleased` bullet in the same commit** —
  anything a consumer acts on: a removal or rename (with its replacement), a behavior fix they were
  working around, new public surface. A release only retitles that section, so an entry missed here
  is an entry that never gets written — 0.7.0 shipped with none, and the consumer adopting it read
  `git log` instead. Purely internal work adds nothing.
- **rati's id prefixes:** **DATA** (the `rati/data` package), **DX** (testing + developer
  experience), **IMP** (improvement review), **REV** (production review), **SI** (scope/island).
  Findings land in docs/backlog/findings/issues/.

## Restricted actions

- **Don't run `vp lint --fix` blindly** — `no-unnecessary-type-assertion`'s autofix breaks the
  typecheck, which is why that rule is off here and tsc is the authoritative gate; the detail is
  $JNANA_KIT_HOME/plugin/docs/toolchain/lint.md.

## Toolchain — Vite+ (`vp`)

Type-checking is **tsc** run from the workspace root as `yarn run -T tsc`, and lint/format config
lives in the root `vite.config.ts` `lint`/`fmt` blocks. The pinned versions, the `.d.ts` emit and
the lint deviations are docs/current/internals.md §Toolchain.

```bash
vp run rati#build         # vite lib bundle + tsc emits dist/*.d.ts
vp run rati#typecheck     # tsc --noEmit (src); rati#typecheck:test for the test tree
vp run rati#test          # Vitest (runtime + *.test-d.ts type tests via the tsc checker)
```

## Source layout (`packages/rati/src`)

`main.ts` is the only public barrel; the subpath entries are `rati/data`, `rati/mobx`, `rati/ssr`,
`rati/server`, `rati/vite`, `rati/testing` and `rati/debug`. Everything else — `mandala/` (the
engine — "one engine, two faces"), `scope/`, `island/`, `router/`, `head/`, `util/`, `types/` — is
internal, and the per-file map is docs/current/internals.md §Source layout.

## Key patterns

- **Reactivity = `useSyncExternalStore`.** Core is MobX-free: a `Source` is a
  `subscribe`/`getSnapshot` pair, the router is a plain external store, and components read both
  through uSES (no `observer`). Optional MobX bindings (`observableSource`) live in `rati/mobx`.
- **No stores container.** An app's store graph is app code behind its own context. The router is
  provided on its own (`createRouter` → `RouterProvider` → `useRouter`), and the `Router` type is
  table-blind (typed off the `RatiUserTypes` augmentation), so app containers hold it without
  importing the route table.
- **No decorators anywhere** — the toolchain is pure oxc, with no Babel lowering in it, and
  `rati/data` models state as plain observable objects from factories.
- **`rati-dev` export condition** exposes `src/main.ts` so consumers (Jnana, the examples)
  type-check and bundle rati's *source* in dev — edits are picked up with no build. The published
  `import`/`types` conditions point at `dist/`.
- **Lint policy** (root `vite.config.ts`): the type-machinery rules — `no-explicit-any`,
  `no-non-null-assertion`, `no-empty-object-type`, `no-redundant-type-constituents` — are
  **`warn`**, because they fire on intentional generic constraints like `Scope<any>`, the
  `RatiUserTypes {}` augmentation interface and `arr[i]!`. `no-unnecessary-type-assertion` is
  **off** (see Restricted actions); everything else is strict, and React rules apply repo-wide.
- **Markdown is dprint's, not oxfmt's** — oxfmt corrupts snake_case next to emphasis, so `**/*.md`
  is excluded in the `fmt` block. dprint reflows it instead: on commit through the staged task, and
  repo-wide through the `markdown` gate stage. Never run `dprint fmt` yourself — a bare reflow
  bypasses the mangle scan, and dprint cannot see its own damage (jnana-kit:FND-47). Use
  `dprint-mangle-scan.ts --fmt <file.md…>`, which the gate's own failure names.
- rati uses **relative imports** (no `#` path alias), and no barrel beyond `main.ts`.
- Keep the *why* comments and the `console.*` you didn't write.

## Examples — current status

`examples/demo` and `examples/ssr` are on the current `scope`/`island`/`route` API and both
typecheck, build, and lint — so `vp lint` is green repo-wide (the `rati` package emits only the
intentional type-machinery warnings). `demo` is a client-only SPA showing plain route components,
route params, and `scope().load(…)` waterfalls (incl. a store class). `ssr` is a server-rendered
**feature gallery** — a page per concept (async loads + dehydration, an `input`→`hook`→dependent
waterfall, the `useRouteContext` value channel, a MobX store as a class load, a `Source`-backed live
clock, an error-slot + `retry`, a `lazy()` route whose chunk the built page preloads, and a route
whose `wrapper` throws on the server to show the CSR fallback), each foregrounding its server/client
behavior. It has no server and no build script of its own: `rati/vite` runs dev and both build
environments (`vp dev` / `vp build`), so `index.html` is a plain shell — no `<script>`, no build
input — and `serve.ts` is ~12 lines over `rati/server` (`vp run ssr-demo#start`, after
`vp run rati#build` — plain node resolves the published entry, not the `rati-dev` source condition).

The mechanism the gallery leans on — `prerender` over `renderToString`, dehydration through the
`rati/ssr` entry, and what that demands of a load or a `Source` — is docs/current/internals.md §SSR
dehydration.

## Memory

Where a note lands here: the canonical docs are the stations, and point-in-time status goes to the
owning work-item record — never to a `.claude/` note that then has to be kept in sync with both.
