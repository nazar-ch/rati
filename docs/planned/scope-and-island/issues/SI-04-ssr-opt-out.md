# SI-04 — per-island `ssr: false`

area: packages/rati/src/mandala/{resolver.tsx,hydration.tsx}, src/island/island.ts,
      src/router/route.tsx, examples/ssr, docs
needs: — (B1; if run alongside SI-01, land after it — shared resolver files)
disposition: cut 2026-07-19 from scope-and-island-directions.md §2

## Problem

Under `prerender` every promise load gates TTFB — there is no "this island is below the
fold / expensive / personalized; ship its loading slot instead". The shipped source-side
marker (`ssr: true` on sources) covers the opposite direction; this completes the matrix.
It is also the sanctioned pressure valve for the deliberate non-goal of streaming SSR:
`prerender` stays all-or-nothing, and islands that shouldn't block opt out.

## Scope

1. **`ssr?: boolean` (default `true`) on `island()` and `RouteOptions`.** When `false` and a
   collector is present (server render), the mandala skips starting the island's loads —
   no promise cells built, nothing recorded in the collector — and renders the loading slot
   into the HTML. Client-side the island resolves normally after hydration.
2. **Hydration contract:** the server HTML shows the loading slot; the client's first render
   must match it (loading slot again), then resolve — the same shape a pending source
   already produces under SSR, so no React mismatch. Pin the full round-trip.
3. **Interaction audit:** an `ssr: false` island whose scope contains an `ssr: true` source —
   the island-level opt-out wins (nothing on this island resolves server-side); document
   the precedence. Errors: an opted-out island can't contribute SSR errors by construction.
4. **Gallery page** (`examples/ssr`): a page with one opted-out island next to a normal one,
   foregrounding "this HTML shipped a spinner on purpose" — the pattern consumers copy.
5. **Docs:** guide SSR section (when to opt out, the streaming-non-goal framing) and
   reference (island/route options); `docs/current/public/ssr.md` if it carries the SSR
   matrix.

## Boundaries

- No per-load opt-out — the island is the unit (matches the all-or-nothing resolution
  model).
- No change to source `ssr: true` semantics.
- Client-only (`island()` without any collector) behavior untouched — the option reads as
  a no-op there.

## Verify

- `yarn ci` green.
- Pins: collected render of an `ssr: false` island emits the loading slot and records no
  hydration entry for it; hydration produces no mismatch warning and the island resolves
  client-side; a sibling normal island on the same page still dehydrates; the precedence
  case (island `ssr: false` + source `ssr: true`) pinned.
- The gallery builds and the new page behaves as described under `vp run ssr-demo#start`
  against the built package.
