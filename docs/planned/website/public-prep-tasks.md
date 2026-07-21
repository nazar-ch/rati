# Public-prep — task batches (July 2026)

The next batch of work preparing rati to share, sequenced for delegation. Prefixes:
**CORE** (the rati package), **DOC** (documentation), **SITE** (the website workspace),
**EXT** (other repos). Tasks are sized for one agent each; unless a dependency says
otherwise, tasks within a batch can run in parallel.

Standing rules for every task: run `vp run rati#typecheck` (or `website#typecheck`) and
`vp lint` before committing; plain-imperative commit messages (no Conventional Commits);
keep `docs/*.md` in sync with behavior changes; never publish.

**Prerequisite (in execution, not a task here):** the stores/router redesign —
[naming.md §6](docs/archive/directions-2026-07/naming.md) +
[stores-and-router.md Option A](docs/research/stores-and-router.md)
(router constructed outside the container, `new RouterStore(routes, options?)`,
`StoresProvider` / `createStoresHook`). DOC-2 and SITE-1 consume its result.

---

## Batch A — rati core (from the nazar.ch SSR review)

> **Done 2026-07-14**, executed as one SSR-baseline round rather than per-task (deltas
> per item recorded in ssr-nazar-patterns.md; the public surface in docs/public/ssr.md).
> Beyond the letter of the tasks: CORE-1 shipped as an inert JSON script tag (not the
> window global) plus integrity diagnostics; CORE-2 also produced `renderApp` (the
> composed per-request loop); CORE-3 grew collector error recording (data-driven
> 404/500); CORE-4 includes `<Meta>` + `useTitle` with the template in store config.
> Follow-ups (server kit, consumer migrations, remaining tests) live in the
> ssr-baseline-remains effort (docs/planned/ssr-baseline-remains/).

All grounded in
[ssr-nazar-patterns.md](docs/archive/directions-2026-07/ssr-nazar-patterns.md); mutually
independent.

- **CORE-1 — Hydration payload type + safe serialization.** In `rati/ssr`: a combined
  hydration-state type (router snapshot + island data), `serializeHydration(state)`
  emitting the XSS-escaped `<script>` tag (escape `<` `>` `&` U+2028 U+2029; document the
  before-`</body>` placement contract), and a client-side `readHydration()`. Port the
  logic from nazar's `escapeJsonForScript`; add tests for the escaping. *Done when:*
  `examples/ssr` uses it and its hand-rolled equivalent is deleted.
- **CORE-2 — `renderToHtml` helper.** In `rati/ssr`: wrap `react-dom/static`
  `prerender` + stream drain into `renderToHtml(element, { bootstrapModules })`.
  `react-dom` stays a peer import. *Done when:* `examples/ssr`'s drain loop is replaced.
- **CORE-3 — Match status on `PreparedRoute`.** Expose whether only the `*` catch-all
  matched (e.g. `matchedCatchAll: boolean`) so servers derive 404s without route-name
  conventions. Update `examples/ssr` to use it. Tiny.
- **CORE-4 — Title management.** Absorb nazar's `head.tsx` (`HeadStore`, `<Title>`,
  `TitleManager`, `HeadProvider`) into rati, preserving its documented correctness
  constraints (store-per-tree, register-during-render, read-after-prerender, effect-driven
  `document.title`, seq dedupe). Title-only — no meta tags. Decide placement (core barrel
  vs `rati/ssr` for the server read) during implementation; document in both public docs.
- **CORE-5 — SSR example & docs fixes.** Add `Content-Type` to `examples/ssr`'s static
  serving; document in the public guide's SSR section (`docs/public/guide.md`, if
  it fits): the whole-document pattern (hydrate `document`, injected tags outside the
  React tree) and the per-request lifecycle (`router.dispose()`).
- **CORE-6 — Route-level redirects.** A `redirectTo` option on `route()` for internal
  redirects: `prepareRoute` reports it (e.g. `redirect: { to, permanent? }`) so a server
  can respond 30x before rendering, and the client router honors it like a `<Navigate>`.
  External URLs stay at the HTTP layer. Migrate the demo app's `<Navigate>`-only settings
  route to it. Spec: ssr-nazar-patterns §5.

## Batch B — documentation

- **DOC-1 — Maintainer review of the public docs.** *(User.)* Review
  [docs/current/public/guide.md](docs/current/public/guide.md) and [docs/current/public/reference.md](docs/current/public/reference.md) —
  positioning wording, example tone, anything over- or under-promised.
- **DOC-2 — Reconcile the stores surface.** After the stores/router redesign lands:
  verify/fix the guide's App-setup section and the reference's §Stores + `RouterStore`
  constructor signature against the real exports; remove the "being finalized" notes.
  Depends on: the prerequisite; blocks SITE-1's app wiring being final.
- **DOC-3 — Public README.** Rewrite the repo/package README from the boilerplate copy in
  [website-plan.md §2](website-plan.md): tagline, the before/after example, three
  bullets, install + minimal setup, links to guide/reference. No "framework", no
  vocabulary meta-talk.
- **DOC-4 — Package metadata.** `packages/rati/package.json`: `description` (the
  tagline), `keywords`, `repository`/`homepage` fields. One small commit.
- **DOC-5 — Snippet verification harness** *(nice-to-have).* Extract fenced `ts`/`tsx`
  blocks from `docs/public/*.md` into a typechecked test tree so doc code can't rot.
  Defer if it fights the tooling.

## Batch C — website foundation

- **SITE-1 — Workspace scaffold.** `website/` yarn workspace (name `website`) consuming
  rati via `rati-dev`; `vp` scripts (`dev`, `build`, `typecheck`, `lint` green);
  routes table + app setup per the redesigned stores surface; placeholder pages for the
  full site map in [website-plan.md §4](website-plan.md). Depends on: prerequisite
  (app wiring), nothing else.
- **SITE-2 — Data layer + network panel.** The bundled Swiss-network dataset with
  now-relative schedule generation; the simulated API client; `NetworkConditionsStore`
  (latency, jitter, failure modes incl. `not-available`); the docked panel component with
  replay/reset. Spec: [website-plan.md §3](website-plan.md). Depends on: SITE-1.
- **SITE-3 — SSR server.** Node server on the nazar.ch pattern (dev: Vite middleware;
  prod: static + rendered), using CORE-1/2/3 helpers (fall back to the nazar pattern
  inline if a helper hasn't landed, with a TODO). Titles via CORE-4 when available.
  Depends on: SITE-1; ideally after CORE-1..3.
- **SITE-4 — Design foundation.** Palette (parrot green/teal + warm accent), layout
  shell, nav, footer (name-story line), and the **split-flap board component** (the
  signature visual — animated flips on value change, reusable at hero and board sizes).
  Depends on: SITE-1.

## Batch D — website pages

All depend on SITE-1/2/4; SSR-dependent demos (SITE-28) also on SITE-3. Copy drafts and
per-page specs: [website-plan.md §5](website-plan.md).

- **SITE-10 — Hero board** (split-flap + clock source + panel wiring).
- **SITE-11 — Before/after code component** (side-by-side, shiki highlighting).
- **SITE-12 — Home page** assembly + copy.
- **SITE-20 — Pain: `spinner-dance`** (slots + retry + not-available).
- **SITE-21 — Waterfall timeline** instrumentation + component.
- **SITE-22 — Pain: `hidden-waterfall`** (scope-swap demo on the timeline).
- **SITE-23 — Twoslash snippet pipeline** (build-time hover types).
- **SITE-24 — Pain: `undefined-forever`** (typed before/after + break-the-backend snippet).
- **SITE-25 — Pain: `live-wire`** (clock + delay drift, attach/detach counter, SSR note).
- **SITE-26 — Compare page** (`keepCurrentRoute` split view).
- **SITE-27 — Pain: `route-to-nowhere`** (typed links, prefetch log; uses SITE-26).
- **SITE-28 — Pain: `double-fetch`** (dehydrated-payload inspector, zero-fetch hydration log).
- **SITE-29 — Pain: `prop-relay`** (`useScope`/`useRouteContext` widgets).
- **SITE-30 — Board index + station page** (the full app; typed links between stations).
- **SITE-40 — Markdown pipeline** (unified + shiki; docs compiled at build; content as an
  async load in `docScope` so docs pages SSR/dehydrate).
- **SITE-41 — Guide & reference pages** (sidebar from `##` sections, anchors,
  guide→pain cross-links). Depends on: SITE-40.
- **SITE-42 — About page.**

## Batch E — integration & verification

- **SITE-50 — Full-site pass.** Repo-wide `vp lint` + all typechecks green; every route
  SSRs without request-time data (SSG door stays open); network panel works on every
  demo; docs cross-links resolve. A written punch list of gaps found — especially any
  place the site had to work around rati (file those against `docs/research/`, per
  website-plan §6).
- **DOC-6 — Docs/site sync pass.** After the pages exist: align guide wording with what
  the demos actually show; add "see it live" links from guide sections to pain pages.
- **EXT-1 — Migrate nazar.ch** *(in `~/Sites/nazar.ch`)* to the renamed API
  (`RouterStore`, `rati/ssr` entry) and the CORE-1..4 helpers — the first real-world test
  of the rename diff and the new SSR surface. After Batch A lands.

## Suggested order

1. Batch A (parallel) + DOC-3/DOC-4 — no interdependencies.
2. Prerequisite stores work finishes → DOC-2.
3. SITE-1 → SITE-2/3/4 (parallel).
4. Batch D: SITE-10/11/21/23/40 first (shared components/pipelines), then the pages that
   consume them, in any order.
5. Batch E, then DOC-1 (user review) whenever convenient — earlier is cheaper.
