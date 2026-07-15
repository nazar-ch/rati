# SSR-12 — a CSR fallback for whole-document apps

area: packages/rati/src/server, packages/rati/src/ssr
needs: design first — the render-into-document constraint below shapes everything
disposition: —

## Problem

Whole-document and the CSR 500 fallback are mutually exclusive today:
`createRequestHandler` needs a template + `bootstrapModules` to serve the fallback
shell, and a whole-document app has neither, so a render throw answers a plain-text
500 (documented in `docs/public/ssr.md`). SSR-04 hit this on nazar and the maintainer
kept whole-document deliberately. Decision (2026-07-15): the design is open and not
restricted to the existing consumers — nazar doesn't need the fallback, but the
pattern shouldn't structurally lack it for projects that do.

## The design constraint

The template fallback works because the client entry can `createRoot` into the
shell's mount node when there's no payload. A whole-document app hydrates
`hydrateRoot(document, <App/>)` — and React has no `createRoot(document)`: a
client-only render of a component that returns `<html>` has no supported mount call.
Candidate shapes, none validated:

1. **Synthesized minimal document + recovery hydration**: the handler emits a bare
   `<!doctype html><html>…` carrying the style/bootstrap tags (it has `assets`), the
   client calls `hydrateRoot(document)` as usual, the mismatch triggers React's
   recover-by-client-render. Zero new client API, but leans on recovery semantics and
   logs a hydration error.
2. **An explicit fallback document from the app**: the handler takes an optional
   `fallbackDocument` (a static HTML string the app author writes, with the payload
   marker absent), and the client entry branches: payload present → `hydrateRoot`,
   absent → replace `document.documentElement` / hydrate the synthesized shell
   knowingly. More surface, honest semantics.
3. **Declare the exclusivity permanent** and document the mitigation (a reverse-proxy
   error page). Cheapest; matches "I don't need it".

## Scope

Design first: a short section in ssr-server-kit.md (or a follow-up record) weighing
the three shapes, including a spike of (1) — does React 19's recovery render actually
produce a working page from a synthesized document, console noise aside? Implement
only after the shape is maintainer-confirmed.

## Boundaries

- The template pattern's fallback is the reference behavior; don't regress it.
- Anti-bloat: no second handler, no new entry — whatever ships hangs off the existing
  `createRequestHandler` options.

## Verify

The spike's findings recorded; if implementation follows, an
`ssr/wholeDocument`-adjacent test walking throw → fallback → client render.
