# ssr-baseline-remains — server kit, consumer migrations, coverage tail

Status: planned 2026-07-14, cut at the close of the SSR-baseline round.

The 2026-07 SSR baseline shipped in rati core: head management (`Title`/`Meta`/
`useTitle`/`HeadProvider` + `headTags`), the versioned hydration payload
(`serializeHydration`/`readHydration` + integrity diagnostics), collector error
recording with status derivation, route-level redirects + `matchedCatchAll`, and the
composed `renderApp` — documented in [docs/public/ssr.md](../../public/ssr.md), with
per-item deltas stamped into
[ssr-nazar-patterns.md](../../research/directions-2026-07/ssr-nazar-patterns.md). This
effort finishes what that round deliberately left: the **server kit** (Layers 2/3 —
design record: [ssr-server-kit.md](../../research/directions-2026-07/ssr-server-kit.md),
maintainer-confirmed), the **consumer migrations** (nazar.ch, jnana website), and the
**coverage tail** the implementing session consciously left thin.

## Decisions taken 2026-07-14

- Kit shape per ssr-server-kit.md is settled at the layer level (Vite plugin owning
  dev + build + manifest/modulepreload; fetch handler + Node adapter for prod;
  everything under `rati/*` entries, no package slicing). Its anti-bloat lines are
  binding; in-item design freedom is below that line only.
- Consumer migrations wait for the kit (migrate once, not twice); if the kit stalls, a
  checkpoint may re-decide and migrate consumers straight onto the baseline.
- Tracking is manual, jnana-shaped: status derives from rati git — `SSR-NN:` commit
  subjects, a `Closes: SSR-NN` trailer on the finishing commit. No status written into
  these files.

## Items

SSR-01…03 build the kit in dependency order (dev plugin → build/assets →
prod handler + example adoption). SSR-04/05 migrate the two real consumers onto it —
three hosts (plain Node, Vercel function, Hono), one plumbing implementation, which is
the kit's validation. SSR-06 is the independent coverage tail and can run first or in
parallel with anything.

Batching, dependencies, grading: [plan.md](./plan.md).

## Per-item conventions

rati works in atomic commits on the current branch (its `CLAUDE.md`); prefix subjects
with the item id (`SSR-01: …`), put `Closes: SSR-01` in the finishing commit's trailer
block, keep `vp run rati#typecheck` + `vp lint` + `vp run rati#test` green, and keep
`docs/public/ssr.md` + `docs/internals.md` in sync with behavior changes. Findings out
of an item's scope get a dated note appended here, not a silent fix.

## Findings

### 2026-07-15 — from SSR-04 (nazar.ch)

The migration itself is nazar `581eaf1`: −653/+217, the Vercel function down to one
line, no manifest read anywhere. The kit's premise held. What the first real consumer
turned up, none of it fixed in-item:

- **`HeadProvider` clobbers a server-rendered title when the declaring page is inside an
  unresolved Suspense boundary.** The provider sits *above* the route's boundary, so its
  effect runs while the boundary is still unhydrated; `snapshot('client')` counts only
  confirmed entries, finds none, and `defaultTitle` makes the result non-null — so
  `applyToDocument` writes the default over the correct title the server put there
  (`head/domSync.ts:17` has no guard for "nothing confirmed yet"). It self-corrects once
  the boundary hydrates and `<Title>` commits, so in practice it is a title flash;
  observed *stuck* on nazar's large photo pages under the condition below. A first apply
  that leaves the document alone when nothing is confirmed would fix it, but "nothing
  declared yet" and "nothing will be declared" are the same state to the store today —
  which is the actual design question.
- **A large route's content ships out-of-order, so the shell carries the loading slot.**
  React flushes the shell at its chunk budget and emits the rest into a detached
  `<div id="S:0" hidden>` plus a completion script: `/texts` is inline (`<!--$-->`),
  `/pictures/torcal-25` (~99KB) is not. The content *is* in the HTML, so this is not an
  SSR-didn't-run problem, but a no-JS client sees `loading...`. Pre-existing (nazar.ch
  live does it today) and arguably React's normal streaming — rati's contribution is
  wrapping every route in a Suspense boundary, which is what gives React something to
  defer. Worth a decision before the SEO smoke, not a bug report.
- **Whole-document and the CSR 500 fallback are mutually exclusive.** `createRequestHandler`
  needs a template + `bootstrapModules` to serve the fallback shell, and a whole-document
  app has neither, so it gets the plain-text 500. `docs/public/ssr.md` says so; SSR-04's
  scope picked whole-document without weighing it. nazar had no fallback before either,
  so nothing regressed.
- **nazar's reason for whole-document is now stale**, and worth revisiting: its
  `index.html` said React must own `<html>` "so React 19 can hoist `<title>` into
  `<head>`", but rati's head layer never renders a React `<title>` — the server splices
  `headTags` in and the client writes `document.title`. Everything its `Document.tsx`
  renders is static, so the template pattern would fit and would restore the fallback
  above. Maintainer kept whole-document deliberately (test the path first, revisit after).
- **Confirmed: Vercel's Node runtime takes `export default { fetch }` natively**, per its
  docs and exercised locally against the built entry — ssr-server-kit.md:95's assumption
  is good. `vercel build` / a preview deploy stayed **unverified**: the CLI needs auth.
- **Testing note.** React 19.2 gates the Suspense reveal on `requestAnimationFrame`, which
  never fires in a hidden tab — so a headless/background browser leaves the boundary
  un-revealed forever and the page looks broken (this is what made the title clobber above
  look permanent). Verify rati SSR in a *visible* tab; check `document.hidden` before
  believing a hydration failure.

### 2026-07-15 — from SSR-05 (jnana website)

The migration is jnana PR #537 (`claude/host/website-ssr-kit`): +217/−263, the two
hand-rolled files (`server/src/ssr.ts`, `escape-json.ts`) and `render-result.ts` gone,
the Hono server down to one `createRequestHandler` behind `app.all('*')`. The kit again
needed no changes, and this is the first consumer to exercise the **template pattern**
end-to-end (nazar is whole-document) — so the `index.html` shell, the `<!--app-head-->`
slot and the CSR fallback all have a real user now. Verified in a visible browser
through dev, a production build, and the deployed shape (the container image, offline
install and `--production` prune included): hydration console-clean everywhere,
statuses right, the dehydrated island reused. What it turned up, none of it fixed
in-item:

- **A `!isSsrBuild` plugin guard silently inverts under the plugin's build.** Consumers
  that exclude a client-only plugin from the server build (`!isSsrBuild && plugin()` —
  jnana's license-notice emitter) get `isSsrBuild: false` on *every* config call once
  `ratiSsr` opts into the app builder; measured, all three invocations. It doesn't
  error — the guard just stops excluding, and the plugin quietly starts running on the
  SSR bundle. `applyToEnvironment: (env) => env.name === 'client'` is the fix, and
  `docs/public/ssr.md §Build` should say so: this is a migration step for anyone whose
  config branched on the build, and the failure mode is a wrong artifact, not a message.
- **`rati/server` drags in a required `react` peer.** `react` is a non-optional peer of
  the package, but the built `dist/server/index.js` imports only `node:*` builtins and
  the react-free `html-*` chunk. A server-only workspace that installs rati purely for
  `createRequestHandler` (jnana's `website/server`) gets a spurious peer warning and is
  told to install React to run a Node listener. Packaging-level; the entries are already
  sliced, the peer declaration just isn't.
- **`no-match` turns a styled 404 into a plain-text one, unannounced.** The website had
  no catch-all, so its old server filled the template with an empty `#root` at status
  404 — blank, but styled and analytics-bearing. `createRequestHandler` answers
  `kind: 'no-match'` with `text/plain` "Not found". Arguably the better default (a blank
  styled page is worse), and `serve()`'s doc note assumes a catch-all exists — but a
  migrating consumer without one loses its shell and nothing says so. A line in
  §Response statuses would cover it.
- **SSR-04's head clobber did not reproduce here, which narrows it.** `/wait` declares
  `<Title>` from a resolved scope prop *inside* the route's Suspense boundary — SSR-04's
  shape exactly — and the title is correct in the HTML and stays correct through
  hydration, in dev and in a production build. The difference is dehydration: the
  island's data comes back in the payload, so the boundary hydrates immediately and
  `commit` lands before `applyToDocument` can write `defaultTitle` over it. So the bug
  needs a boundary that is *still* unhydrated when `HeadProvider`'s effect runs — a
  source-backed page, a `lazy()` chunk still in flight, or React deferring the reveal on
  a large page (nazar's). Dehydrated async loads are safe. The design question
  (`domSync.ts:17` cannot tell "nothing declared yet" from "nothing will be declared")
  is unchanged, but its blast radius is smaller than SSR-04 implied.

### 2026-07-15 — from SSR-06 (coverage tail)

The listed gaps are closed: +13 tests across the head store's dedupe/depth edges, the
payload's `id` option, the watchdog's two ends, `renderApp`'s `onError`/version, the
redirect × hydration replay, and a new `ssr/wholeDocument.test.tsx` walking the
document-as-root pattern from prerender through `hydrateRoot(document)`. Each was
verified red under a one-line behavior break (per-commit notes). Two things the round
turned up, neither fixed in-item:

- **A redirect whose target is outside the route table answers 404 and drops the 301.**
  `route('/old', …, { redirect: { to: '/new' } })` where `/new` is not a rati route: the
  router follows the hop and records it in `redirectHops`, but nothing matches `/new`, so
  `activeRoute` is null → `prepareRoute` returns null → `renderApp` reads that as
  `no-match` *before* it ever looks at a redirect (`renderApp.tsx:130` precedes the
  `prepared.redirect` check at `:131`). The hop is computed and discarded; the author's
  declared 301 never goes out. Reachable whenever a target is same-origin but not a rati
  route — a static file, a legacy app, another SPA mounted elsewhere; `docs/public/ssr.md`
  sends *external* redirects to the HTTP layer, but a same-origin non-route is neither
  external nor in the table. Two fix shapes, both small: `prepareRoute` reports a redirect
  even with no `activeRoute` (the hop is already recorded, only `hydratedState` has
  nothing to describe), or `renderApp` checks the hops before answering `no-match`. Same
  neighborhood as SSR-05's `no-match` finding — a fix should weigh them together. Pinned
  as-is in `ssr/renderApp.test.tsx`.
- **Hydrating onto a redirect route renders blank, and that is defensible.** Scope item 3
  asked for the pin and got it: seeding from `hydratedState` never follows a redirect, so
  a snapshot naming the redirect route itself leaves it active and renders its (empty)
  component. Reachable only from a server that ignored `renderApp`'s redirect result *and*
  built its own snapshot — the normal flow names the target. Judged right rather than
  merely current: seeding is a verbatim replay of the server's decision, and following the
  hop would move the URL out from under the server's HTML. Recorded so the next reader
  doesn't re-litigate it; no item cut.
