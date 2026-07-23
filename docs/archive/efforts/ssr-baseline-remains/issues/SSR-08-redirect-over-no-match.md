---
area: packages/rati/src/ssr, packages/rati/src/router/prepareRoute.ts
needs: —
status: done
disposition: —
---

# SSR-08 — a followed redirect wins over no-match

## Problem

`route('/old', …, { redirect: { to: '/new' } })` where `/new` is not a rati route:
the router follows the hop and records it in `redirectHops`, but nothing matches
`/new`, so `activeRoute` is null → `prepareRoute` returns null → `renderApp` answers
`no-match` before it ever looks at a redirect (`renderApp.tsx:130` precedes the
`prepared.redirect` check). The author's declared 301 is computed and dropped.
Reachable whenever a target is same-origin but not a rati route — a static file, a
legacy app, another SPA mounted elsewhere. Pinned as-is by SSR-06 in
`ssr/renderApp.test.tsx`.

Same neighborhood (SSR-05's finding, weighed together per the effort README):
`createRequestHandler` answers `kind: 'no-match'` with a `text/plain` 404. Arguably
the right default, but a migrating consumer without a catch-all loses its styled shell
and nothing in the docs says so.

## Scope

1. `renderApp`: when `prepareRoute` returns null, check the router's `redirectHops`
   before answering `no-match` — hops present means a followed redirect whose target
   is outside the table, and the result is the redirect (301 only when every hop was
   permanent, as elsewhere). Flip SSR-06's pin to the fixed behavior.
2. `prepareRoute`'s doc comment: note that a null return can hide a followed redirect
   and that direct callers should consult `redirectHops` — its contract (null = no
   route to describe) doesn't change.
3. `docs/public/ssr.md`: §Redirects gets the outside-the-table case; §Response
   statuses (or the handler section) gets one line saying `no-match` is a plain-text
   404 — add a `*` catch-all to keep a styled not-found page.

## Boundaries

- Don't restructure `PreparedRoute` — a redirect-only variant with a null
  `hydratedState` is a public-type break for a case `renderApp` can answer from the
  router it already holds.
- The handler's plain-text `no-match` body stays — the fix for a styled 404 is a
  catch-all route, not a template splice.

## Verify

`vp run rati#test` green, with the flipped pin demonstrably red on the old ordering.
`vp run rati#typecheck` + `vp lint`.
