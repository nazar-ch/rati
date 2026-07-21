# SSR-11 — the out-of-order shell (large routes ship the loading slot)

area: packages/rati/src/ssr/renderToHtml.ts
needs: —
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

This is **not** streaming vs full render — rati is already full-render. `renderToHtml`
awaits every Suspense boundary via `prerender`, drains the whole prelude into one
string, and the server sends one complete response. The out-of-order segments are the
*wire format* of React's streaming heuristic surviving into a buffered renderer: the
outlining exists so a streaming server could flush a small shell early — rati never
flushes early, so today the output pays streaming's costs (hidden content, JS-gated
reveal, no-JS sees "loading…") and collects none of its benefit.

## Decision (maintainer, 2026-07-15)

Fully-inline output simply becomes the behavior — no new API; the current output is an
artifact of defaults, not a choice. A true streaming mode is a **different contract**
(status commits at shell flush → effectively always 200; the head ships before
in-Suspense `<Title>`s register) and is recorded as research, not built:
[ssr-streaming.md](docs/research/undecided/ssr-streaming.md).

## Scope

1. `renderToHtml`: pass a `progressiveChunkSize` large enough that every completed
   boundary renders inline (content in place, no hidden divs, no swap scripts), with a
   comment saying why — buffered output, so outlining is pure downside.
2. A test pinning the shape: a route whose content exceeds the default budget renders
   in place (`<!--$-->…<!--/$-->`, no `id="S:` divs) — demonstrably red without the
   option.
3. `docs/public/ssr.md`: one paragraph — output is fully inline by design (no-JS/SEO
   sees content); streaming is a non-goal with the research pointer.

## Boundaries

- No option surface — no `progressiveChunkSize`/`inline` knob on `renderApp` or the
  handler; anyone wanting streamed output wants the other contract entirely.
- Server-errored boundaries keep the loading slot + client retry (SSR baseline
  behavior) — inlining changes completed boundaries only.

## Verify

`vp run rati#test` green with the new pin; `vp run rati#typecheck` + `vp lint`;
spot-check the ssr example's built output for a large page if convenient.
