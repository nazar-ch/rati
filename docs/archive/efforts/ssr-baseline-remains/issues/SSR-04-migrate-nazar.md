# SSR-04 — migrate nazar.ch onto the released SSR surface

area: ~/Sites/nazar.ch/site (external repo)
needs: SSR-03 (kit path; see Boundaries for the baseline-only variant), a rati release
disposition: —

## Problem

nazar.ch is on the pre-rename surface (`WebRouterStore`, `IslandHydrationProvider`,
main-barrel imports) and hand-rolls everything the baseline absorbed from it: `head.tsx`
(HeadStore/Title/TitleManager), `escapeJsonForScript` ×2, `prerenderToString`, the
route-name-convention 404, the post-prerender title injection. It is the first
real-world test of both the rename diff and the absorbed APIs
([ssr-nazar-patterns.md](docs/archive/directions-2026-07/ssr-nazar-patterns.md)).

## Scope

1. Rename sweep to the current surface (`RouterStore`, `HydrationProvider` via
   `rati/ssr`, …).
2. Replace `src/head.tsx` with rati's head API — suffix moves to
   `createHeadStore({ defaultTitle, titleTemplate })`; TitleManager mount disappears
   (HeadProvider owns the sync). Static meta may move to `<Meta>` where per-page.
3. Replace the render pipeline with `renderApp` (whole-document pattern: splice
   `headTags`/`stateScript` into the document string) and the payload with
   `serializeHydration`/`readHydration`; delete both `escapeJsonForScript` copies.
4. Status codes from the result (`matchedCatchAll`/errors) instead of
   `activeRouteName === 'notFound'`.
5. Server/Vercel plumbing onto the kit: dev via the plugin, the Vercel function
   consuming `createRequestHandler` (fetch-native) with `virtual:rati/assets` replacing
   the manifest-reading block. `/talk` stays a `vercel.json` redirect (external URLs
   stay at the HTTP layer).

## Boundaries

- Behavior-preserving migration: same pages, same titles, same analytics injection
  (outside the React tree). Anything that looks like a rati bug is a finding for the
  effort README, not an inline fix.
- **Baseline-only variant** (if B2 stalls and the checkpoint re-decides): steps 1–4
  without the kit — keep the hand-written `server.ts`/`api/ssr.ts` shells, consuming
  `renderApp` + the payload/head helpers directly.

## Verify

Local dev + `vercel build` (or preview deploy): view-source shows title/meta/payload
tags; 404 for an unknown path; hydration console-clean; Plausible tag intact; the
Lighthouse/SEO smoke the site normally gets.
