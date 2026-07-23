# ssr-baseline-remains — server kit, consumer migrations, coverage tail

> **Archived 2026-07-19** — closed tracker, kept as the historical record. No successor
> effort and no open items carried: all fifteen landed. The behavioral reference is
> [docs/current/public/ssr.md](docs/current/public/ssr.md); the design records it executed
> live in [directions-2026-07/](docs/archive/directions-2026-07/README.md).

Status: **done — cut 2026-07-14 at the close of the SSR-baseline round, closed & archived
2026-07-19.** Per-item status is each record's own `status:` field — never from this file;
conventions below.

The 2026-07 SSR baseline shipped in rati core: head management (`Title`/`Meta`/
`useTitle`/`HeadProvider` + `headTags`), the versioned hydration payload
(`serializeHydration`/`readHydration` + integrity diagnostics), collector error
recording with status derivation, route-level redirects + `matchedCatchAll`, and the
composed `renderApp` — documented in [docs/current/public/ssr.md](docs/current/public/ssr.md), with
per-item deltas stamped into
[ssr-nazar-patterns.md](docs/archive/directions-2026-07/ssr-nazar-patterns.md). This
effort finishes what that round deliberately left: the **server kit** (Layers 2/3 —
design record: [ssr-server-kit.md](docs/archive/directions-2026-07/ssr-server-kit.md),
maintainer-confirmed), the **consumer migrations** (nazar.ch, jnana website), and the
**coverage tail** the implementing session consciously left thin.

## Decisions taken 2026-07-14

- Kit shape per ssr-server-kit.md is settled at the layer level (Vite plugin owning
  dev + build + manifest/modulepreload; fetch handler + Node adapter for prod;
  everything under `rati/*` entries, no package slicing). Its anti-bloat lines are
  binding; in-item design freedom is below that line only.
- Consumer migrations wait for the kit (migrate once, not twice); if the kit stalls, a
  checkpoint may re-decide and migrate consumers straight onto the baseline.
- Tracking is manual, jnana-shaped: at cut, status derived from rati git — `SSR-NN:` commit
  subjects, a `Closes: SSR-NN` trailer on the finishing commit. **Superseded 2026-07-21** by
  the tree-wide adoption of jnana's record convention — status is each record's own
  `status:` field.

## Decisions taken 2026-07-15 (findings round)

The findings below were task-cut into SSR-07…12 (maintainer-reviewed shape):

- **SSR-07** fixes the head clobber via a distinct hydration phase (server-owned
  document until the first `remove()`; CSR detected by the absence of marked tags) —
  chosen over a bare first-apply guard so pure-CSR `defaultTitle` keeps working.
- **SSR-08** makes a followed redirect win over `no-match` and documents the
  plain-text 404 — the two same-neighborhood findings weighed together, as recorded.
- **SSR-09** (react as optional peer) and **SSR-10** (docs tail: the `!isSsrBuild`
  inversion, the hidden-tab/rAF testing note) are mechanical.
- **SSR-11** (the out-of-order shell): discussed and decided same day — fully-inline
  output becomes the behavior (the current output is a buffered-render artifact, not a
  streaming tradeoff); what a real streaming mode would take is recorded in
  [docs/research/undecided/ssr-streaming.md](docs/research/undecided/ssr-streaming.md), alongside the RSC
  support question ([docs/research/postponed/rsc-support.md](docs/research/postponed/rsc-support.md)).
- **SSR-12** reframes the whole-document finding: not a nazar migration (the
  maintainer keeps nazar whole-document) but a design item — the CSR fallback should
  be available to whole-document apps too. Design-first; nazar's stale-reason note
  stays a nazar-side concern.
- The Vercel `vercel build`/preview verification stays blocked on maintainer CLI auth
  — not cuttable as agent work.
- No item for the redirect-route hydration blank (judged right, recorded) or for the
  whole-document ⇄ fallback exclusivity docs (SSR-12 owns that surface).

## Decisions taken 2026-07-16 (post-findings-round review)

- **SSR-12 is approved for implementation.** Both open points confirmed: the
  `createRoot(document)` supportedness soft spot is accepted, and `template ===
  undefined` stays the whole-document signal (no new option). One addition: a canary
  pin that renders a synthesized document through `createRoot(document)`, so the React
  release that narrows the container fails rati's gate, not a consumer's fallback.
  Scope in the item record; the design record carries the decision line.
- **SSR-13 cut** from RF-01's out-of-scope finding (router-fuzz README, 2026-07-16):
  the dev server 500s on a malformed escape (`/products/%zz`) where production answers
  the app's 404 — `assemble` hands the raw URL to `transformIndexHtml`, whose decode
  throws after the app already rendered. Dev must agree with production.

## Items

SSR-01…03 build the kit in dependency order (dev plugin → build/assets →
prod handler + example adoption). SSR-04/05 migrate the two real consumers onto it —
three hosts (plain Node, Vercel function, Hono), one plumbing implementation, which is
the kit's validation. SSR-06 is the independent coverage tail and can run first or in
parallel with anything.

The findings round: SSR-07…10 are independent fixes off the migrations' findings and
can run in any order; SSR-11 waits on a maintainer discussion and SSR-12 on a design
pass (both records carry the open questions).

The tail (2026-07-16): SSR-12's implementation (approved above) and SSR-13 — independent
of each other, any order.

Round-2 corrections (2026-07-16, cut at the review): SSR-14 (hydration-mismatch
observability, from SSR-12's finding) and SSR-15 (the fallback config-error guard) —
independent, any order.

Batching, dependencies, grading: [plan.md](plan.md).

## Per-item conventions

rati works in atomic commits on the current branch (its `CLAUDE.md`); prefix subjects
with the item id (`SSR-01: …`), flip the record's `status: open` → `done` in the finishing
commit, keep `vp run rati#typecheck` + `vp lint` + `vp run rati#test` green, and keep
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

### 2026-07-16 — from the findings round (SSR-07…12)

Small records the executing commits carry, restated here so the README stays the
station; nothing needed a new item beyond SSR-13 (cut above):

- **SSR-07 refined its own detection mid-item**: the bare `[data-rati-head]` check the
  record proposed reads a client-only app's leftover tags (a root unmount tears down the
  provider's subscription before the declarations' removes) as a server head. The marker
  value now carries provenance — `server` from `headTags`, `client` from the DOM sync —
  and detection asks for `server` alone. Consequence: the record's documented caveat
  (a pure-CSR page needing the default in `index.html` too) is gone; `defaultTitle`
  works everywhere it used to. A residual, judged acceptable: a tag the client *adopts*
  keeps its `server` marker even after client-side churn updates it, so a fresh provider
  mounted onto such a document (a root remount without a reload — HMR shapes) re-enters
  the hydrating phase and holds defaults until the first removal. Self-corrects on any
  navigation; no item.
- **SSR-09's fix has a typing edge**: the type surface still names react, so a react-less
  consumer type-checking with `skipLibCheck: false` needs `@types/react`. Every real
  consumer runs `skipLibCheck`; fixing it for real would need the exports gymnastics the
  item's anti-bloat line rules out. Recorded in the commit; accepted.
- **SSR-11's gallery spot-check is weak evidence for the fix itself** — every gallery
  page is under the outlining budget; the pin (a >budget route inside a shell div, red
  without the option) is the real guard. The pin also caught that React never outlines
  the root segment, so a bare island pins nothing — the shell-div wrapper is
  load-bearing and commented.

### 2026-07-16 — from SSR-12 (the whole-document fallback)

The fallback landed as designed. One finding, wider than the item and left unfixed:

- **"Hydrates without console errors" does not test that, and the suites that say it are
  the ones underwriting the baseline's hydration claims.** React reports a recovered
  mismatch to `onRecoverableError`, whose default is `reportGlobalError` — *not*
  `console.error` (`react-dom-client.development.js:9417`; the SSR-12 design record says
  console.error, which is where this started). Under Vitest that lands as an "Unhandled
  Error" the reporter prints and no assertion reads, so a `vi.spyOn(console, 'error')`
  check passes straight through a real mismatch. Measured, not inferred: injecting a
  deliberate text mismatch into `router/hydration.test.tsx`'s `ssrThenHydrate` leaves all
  391 tests green, and its comment (`:105`) states the opposite. `router/hydration.test.tsx`
  is the suite affected — every test in it hydrates through that one helper, and its
  console-only assertion is the whole point of four of them. `ssr/wholeDocument.test.tsx`
  had the same hole and was fixed in-item (it now passes its own `onRecoverableError` and
  asserts it never fired — the canary is worthless otherwise: swapped to `hydrateRoot`, a
  console-only version passes the very shape it exists to distinguish).
  `mandala/islandSsrSources.test.tsx:337` already knows the channel and silences it
  deliberately, so the fix is a known one-liner per mount, not a design question. Not cut
  as an item: it is test-strength in a suite SSR-12 doesn't own, and it may turn something
  up when the assertion starts working — worth its own session, with room to be surprised.
  — **Cut 2026-07-16 (round-2 review) as [SSR-14](issues/SSR-14-hydration-mismatch-observability.md).**

### 2026-07-16 — from SSR-13 (the dev malformed escape)

The fix landed on the item's second candidate shape, because the first one compiled away.
One finding, wider than the item:

- **A builtin called for its throw alone is dead code to the bundler — and no test here
  can see it.** SSR-13's first implementation was the item's leading candidate, sanitize
  up front: `try { decodeURIComponent(url); return url } catch { return
  url.replaceAll('%', '%25') }`. The suite went green and `dist/vite/index.js` shipped
  `function O(e) { try { return e } catch { return e.replaceAll("%","%25") } }` — rolldown
  reads `decodeURIComponent(url)` as a pure call whose result is unused and drops it,
  leaving the identity function. So the fix was a no-op in every consumer while the gate
  called it done. What caught it was the item's gallery spot-check (dev still 500'd on
  `/products/%zz`), and only because the example's vite config imports `rati/vite` through
  the published `import` condition — i.e. by luck of the one thing in this repo that runs
  rati *built*. Every test runs the `rati-dev` source condition, so a behavior change the
  build introduces is invisible to `yarn ci` — the test stage and the build stage never
  meet. Second instance of the family (the first: `is.class` reading
  `Function.prototype.toString`, which minification defeats — the blank `/counter`,
  CLAUDE.md §Examples), and unlike that one this had no symptom in dev at all. The shape
  is ordinary enough to reach for again (a decode/parse probe guarding a fallback), and
  `grep` says the source carries no other instance today. Not cut as an item: the useful
  question is bigger than a lint rule — whether anything should exercise the built
  artifact's *behavior*, given the gate builds it and then only checks that it built.

### 2026-07-16 — round-2 review (SSR-12/13 verified; two items cut)

The review re-verified both items against the code (independent agents, the load-bearing
claims re-executed by hand): the fallback branches and the synthesized document are as
designed, the canary genuinely reads `onRecoverableError` rather than the console, the
`transformHtml` retry is total and correctly narrowed to `URIError`, and the docs are in
sync. Two findings became items, one was closed in-round:

- **A fragment app misconfigured with no template gets the whole-document fallback** —
  `assemble` detects whole-document by content, `fallback` by `template === undefined`,
  and the config-error path threads the gap: the synthesized shell has no `#root` for a
  fragment entry to boot into, where pre-SSR-12 the same misconfiguration answered an
  honest plain-text 500. Verified by tracing the catch path. Cut as
  [SSR-15](issues/SSR-15-fallback-config-error.md), which also owns the noted
  script-placement asymmetry between the two fallback shapes.
- **The standing SSR-12 finding above (console-only hydration asserts) is now cut** as
  [SSR-14](issues/SSR-14-hydration-mismatch-observability.md) — the round's reviewer
  judged "worth its own session" to mean an item, so it derives status like everything
  else.
- **SSR-13's pins covered only `%zz`** of the four shapes the item verified by hand
  against the gallery. Closed in-round: `ratiSsr.test.ts` gains `%FF` (well-formed hex,
  no character), `%2` (truncated) and `%` (stray) rows, with fixture entries to match —
  the first run of those rows also demonstrated why they were missing: the fixture's
  canned-results map answers 500 for any URL it doesn't know, which reads exactly like
  the bug the suite guards against.

The built-artifact-behavior question (SSR-13's note above) deliberately stays a note,
not an item — it is a testing-strategy direction, not a fix with a pin.

### 2026-07-17 — from SSR-14 (the assertion, switched on)

- **Nothing was hiding behind it.** The item cut room to be surprised — an assertion that
  has never worked may be covering real mismatches — and the answer is that it wasn't:
  every mount that claims a clean hydration (the router suite's three, `islandSsr`'s
  rehydrate, `islandSsrSources`' dehydrated-value and seeded-source pair,
  `scopeControls`' waterfall) hydrates with `onRecoverableError` never firing, and all
  406 tests stay green with the channel now read. The suites were telling the truth; they
  just had no way to know it. Recorded because "we looked and found nothing" is the
  finding — the baseline's hydration claims now rest on an assertion that has been
  demonstrated to fail (the canary, re-run per the item's step 2), which is the thing
  they lacked, not on a fix.
