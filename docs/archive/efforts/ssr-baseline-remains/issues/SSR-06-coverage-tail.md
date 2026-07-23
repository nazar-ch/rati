---
area: packages/rati/src/__tests__
needs: —
status: done
disposition: —
---

# SSR-06 — SSR baseline coverage tail

## Problem

The baseline round verified its features end to end (example server probed for
statuses/head/payload/hydration; unit suites for head, payload, errors, redirects,
renderApp), but consciously left deterministic gaps at the seams between features.
This item closes them while the surface is fresh.

## Scope

Deterministic tests (extend the existing suites; no new harness):

1. **Whole-document flow**: prerender an app whose root renders `<html>`, hydrate
   `document` — head read-back and payload round-trip work; no React warnings about
   the spliced-in tags (pins the pattern docs/public/ssr.md promises).
2. **Head × navigation edges**: two `<Meta>`s where one uses `name` and one `property`
   with the same value string (distinct dedupe keys — both render); a `<Title>` inside
   an island that *errors* client-side after having committed (falls back to the outer
   winner); `useTitle` toggling value → null → value keeps its original depth only
   until removed (documented seq semantics).
3. **Redirect × hydration**: a client seeded with `hydratedState` whose route carries a
   `redirect` (a server that ignored the redirect result) — pin the current behavior
   (renders the null component; no follow) so the choice is explicit, not accidental.
4. **Payload options**: custom `id` round-trip; `readHydration` on a tag containing
   escaped `</script>` content (already covered for default id — add the option path).
5. **Watchdog**: a late claim after the warning fired (no crash, single warning); the
   collector-present (server) side never arms it.
6. **renderApp**: `onError` forwarding; `no-match` with a redirect-only table; the
   `hydration.v === 1` invariant on the result.

## Boundaries

- Deterministic only — randomized SSR coverage was explicitly rejected for cost in the
  mandala-fuzz effort (its README, decision 2026-07-12); don't reopen it here.
- Pin behavior, don't change it: anything that looks wrong is a finding for the effort
  README (e.g. if #3's pinned behavior is judged wrong, the fix is its own item).

## Verify

`vp run rati#test` green; each new test demonstrably red under a one-line behavior
break (spot-check two or three, note in the commit message).
