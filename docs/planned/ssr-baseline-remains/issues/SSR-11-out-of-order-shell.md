# SSR-11 — the out-of-order shell (large routes ship the loading slot)

area: packages/rati/src/ssr/renderToHtml.ts
needs: maintainer discussion — no scope until the direction is picked
disposition: —

## Problem

React flushes the shell at its progressive chunk budget (default ~12.5KB) and emits
the rest of a large boundary into a detached `<div id="S:0" hidden>` plus an inline
completion script that swaps it in. SSR-04 observed it on nazar: `/texts` is inline
(`<!--$-->content<!--/$-->`), `/pictures/torcal-25` (~99KB) is not. The content *is*
in the HTML, but out of place and hidden — a no-JS client sees the loading slot, and
the reveal is JS- and rAF-gated (the hidden-tab interaction from SSR-04's testing
note). rati's contribution is wrapping every route in a Suspense boundary, which is
what gives React something to defer.

## The mechanics (for the discussion)

This is **not** streaming vs full render — rati is already full-render. `renderToHtml`
uses `react-dom/static` `prerender`, awaits every Suspense boundary, drains the whole
prelude into one string, and the server sends one complete response. The out-of-order
segments are the *wire format* of React's streaming heuristic surviving into a
buffered renderer: the outlining exists so a streaming server can flush a small shell
early and progressively reveal — but rati never flushes early, so today we pay
streaming's costs (hidden content, JS-gated reveal, no-JS sees "loading…") and collect
none of its benefit (TTFB is identical either way). `prerender` takes
`progressiveChunkSize`; a very large value makes every completed boundary render
inline, in place, with no swap scripts.

A real streaming mode ("stream and accept the current situation") would be a separate
feature with real design costs, because two of rati's SSR guarantees are
read-after-render:

- **Status codes**: `result.status` derives from load errors known only after all
  boundaries resolve. A streamed response commits its status at shell flush — before
  the loads run — so streamed pages are always 200 (or need trailers/meta-refresh
  hacks). The SEO-correct 404/500 derivation is fundamentally a full-render property.
- **Head tags**: `headTags` reads the store's winners after the prerender; the
  `<head>` ships in the shell, first. Streaming means the head flushes before a
  route's `<Title>` inside Suspense has registered — deepest-wins titles would need
  client-side correction, which is exactly the flash SSR-07 exists to avoid.

So the two coherent offerings are: (1) today's model, made honest — full render,
everything inline, correct statuses and head ("SEO-first", one `progressiveChunkSize`
line); (2) a future opt-in streaming mode built on `renderToReadableStream`, accepting
200-always and shell-time head for time-to-first-byte on slow loads. They are not a
knob on one renderer; they are different contracts.

## Open question (maintainer)

Whether (1) simply becomes the behavior (no new API, arguably a bug fix — the current
output is an artifact, not a choice), and whether (2) is worth a research record now
or waits for a consumer that actually wants streaming.
