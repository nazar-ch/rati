---
area: packages/rati/src/vite
needs: —
status: done
disposition: —
---

# SSR-13 — dev and production must agree on a malformed escape

## Problem

`GET /products/%zz` answers **404 in production** — `staticPath` guards its own decode,
the router (since RF-01) warns and hands the raw segment through, and the app's load
reports not-available — but the **dev** server answers 500 `URI malformed`. Found by
RF-01 while driving the gallery (router-fuzz README, findings 2026-07-16), confirmed
pre-existing there (same 500 with RF-01 stashed).

The break is above the app: `assemble` (`vite/ratiSsr.ts`) passes the raw request URL to
`server.transformIndexHtml(url, …)`, and vite-plus-core's `getHtmlFilename` runs
`decodeURIComponent` on it and throws — *after* the app has already rendered its 404.
The middleware's `.catch` hands the URIError to Vite's error middleware, which serves
the 500 overlay. So the router is right and the layer above it drops the result. A URL
is user input; dev disagreeing with production on it means a bad address looks like an
app bug exactly where the developer is watching.

## Scope

1. `vite/ratiSsr.ts`: make `assemble` survive a URL `decodeURIComponent` rejects, so
   the dev answer is the app's answer (the rendered 404, status and body). Candidate
   shapes, in-item choice: sanitize the URL handed to `transformIndexHtml` (the
   malformed escape only needs to become decodable — e.g. re-encode the stray `%` —
   the transform uses the URL as plugin context, not as content), or catch the
   URIError around the call and retry with a safe URL. Both template and
   whole-document paths go through `transformIndexHtml`; cover both.
2. A pin in `__tests__/vite/ratiSsr.test.ts` (the `failures` neighborhood): a request
   with a malformed escape answers with the app's status, not 500 — demonstrably red
   today.
3. If the fix is a sanitization with observable shape, one line in
   `docs/internals.md`'s vite section; no public-docs surface otherwise.

## Boundaries

- Don't touch the router's malformed-escape handling (RF-01 settled it: warn, hand the
  raw segment through) or `staticPath`'s guard — this is only the dev assembly layer.
- Production (`rati/server`) already agrees with the app; no changes there.

## Verify

`vp run rati#test` green with the new pin (red without the fix); `vp run
rati#typecheck` + `vp lint`. Spot-check against the gallery dev server:
`GET /products/%zz` → the app's 404 page.
