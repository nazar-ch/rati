# SSR-15 — the CSR fallback must not serve a shell the app cannot boot

area: packages/rati/src/server/requestHandler.ts
needs: — (independent; SSR-12 landed)
disposition: cut 2026-07-16 (round-2 review), from an agent finding verified by hand

## Problem

`assemble` and `fallback` detect "whole-document" by different signals: `assemble`
inspects the rendered HTML (`isWholeDocument`), `fallback` reads `template ===
undefined`. A *fragment* app misconfigured with no template threads the gap: the render
succeeds, `assemble` throws its helpful "pass your index.html" config error, the catch
routes it to `fallback` — which, seeing no template, synthesizes the whole-document
shell. A fragment client entry then boots `createRoot(getElementById('root'))` against a
document that has no `#root`. Pre-SSR-12 this same misconfiguration answered plain-text
500, which was at least honest. The developer does still see the real error via
`onError`, and no correctly-configured app is affected — but the handler's own
configuration error should not be answered with a shell built for a different kind of
app.

Also noted in the same review, same file: the two fallback shapes place the bootstrap
scripts differently (the template fold puts them in the head slot, `synthesizeDocument`
in `<body>`). Both work — module scripts defer — but the asymmetry is unexplained.

## Scope

1. The handler's own config error (the `assemble` throw for "fragment + no template")
   answers plain-text 500 instead of reaching the whole-document fallback — tag the
   error where it is thrown and check in the catch (or equivalent), so `fallback`'s
   `template === undefined` branch is reached only by apps that actually render whole
   documents. `onError` still fires.
2. Pin: fragment render + no template + `assets` present → `text/plain` 500, not a
   synthesized `<html>`; the whole-document throw→fallback pin stays untouched.
3. The script-placement asymmetry: unify, or comment why the two shapes differ — either
   way the next reader stops tripping on it.

## Boundaries

- No new options; the SSR-12 anti-bloat boundary carries over.
- The template fallback's behavior is the reference and must not change.

## Verify

- The new pin red with the guard reverted (executed once, noted at the test);
  `yarn ci` green.
