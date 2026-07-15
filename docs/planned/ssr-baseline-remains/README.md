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
