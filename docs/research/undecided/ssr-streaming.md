# Streaming SSR — what the other contract would take

Status: research only (2026-07-15), out of the SSR-11 discussion. The decision there:
rati's shipped mode is full render with fully-inline output; streaming is **not** a
knob on that renderer but a second contract. This records what the second contract
costs, so a future consumer with a real time-to-first-byte problem can weigh it.
Related: the per-island `ssr: false` valve
(`docs/research/directions-2026-07/improvements.md` §Per-island SSR opt-out (dissolved)) is
the sanctioned cheap answer to "one slow island blocks the page" and should be tried
before any of this.

## What streaming buys, precisely

`renderToReadableStream` flushes the shell (everything outside still-pending Suspense)
as soon as it renders, then streams each boundary's content + swap script as its loads
resolve. The user sees the page frame and fast islands while slow loads are still
running. That is the entire benefit: first paint before the slowest load. TTFB for the
*complete* page is unchanged, and nothing else improves — hydration still waits for
the client entry, which waits for document parse, which waits for the stream end.

## What it breaks (the contract differences)

1. **Status codes.** `result.status` today derives from load errors after all
   boundaries resolve (`matchedCatchAll` → 404, `NotAvailableError` → 404, other →
   500). A streamed response commits its status line at shell flush, before loads run
   — streamed pages are effectively always 200. Redirects and routing-level 404s
   survive (they're decided pre-render); the *data-driven* 404/500 does not. The only
   honest mitigations: await specific loads before the shell (see the level-split
   below), or accept 200 + a client-rendered error state — which is what every
   streaming framework accepts.
2. **Head tags.** `headTags` reads the store's winners after the prerender; a stream's
   `<head>` ships first. A `<Title>` inside a route's Suspense registers too late.
   React 19 can hoist late-streamed metadata via runtime scripts, but that's JS-gated
   — crawlers without JS see the shell-time head. Same mitigation as statuses: the
   title-bearing data must resolve before the shell.
3. **The payload.** `serializeHydration` runs after the render and the tag is spliced
   before `</body>`. Streaming-compatible (append at stream end — the client entry is
   a deferred module, it executes after document parse, i.e. after the stream closes),
   but it becomes a stream stage, not a string splice.

## The rati-shaped opening: the waterfall as the shell line

rati has something generic streaming frameworks don't: scopes already declare loads in
**levels**. A streaming mode could define "level 0 blocks the shell" — await the first
level (or a marked prefix) before flushing, stream the rest. Status and title would
then be derived from the blocking levels (a `NotAvailableError` in level 0 is still a
real 404; a title from level-0 data is in the shell's head), and only below-the-line
loads stream. That turns the existing "where a prop is declared" performance knob into
the streaming knob, with no new concepts. This is the design idea worth keeping; the
rest below is plumbing.

## The plumbing bill

- **Renderer**: `renderToReadableStream` beside `prerender` — two render paths behind
  one option is exactly the two-contracts problem, so likely a separate entry point
  (`renderAppStream`?) returning `{ stream, status, headTags }` where the strings are
  shell-time values. Shell errors (before first flush) can still fall back to CSR;
  post-shell errors degrade in-stream (React's client-retry markers — already the
  model).
- **Assembly**: `html.ts` fills placeholders in complete strings. Streaming needs a
  transform: template-head (with shell-time head tags) → React's stream → payload tag
  → template-tail. Whole-document apps need only the tail injection.
- **Handler/adapter**: `createRequestHandler` returns a `Response` with a stream body
  (fetch-shaped already — cheap); `serve`'s Node adapter needs web-stream → `res`
  piping with backpressure.
- **Collector**: unchanged (it accretes during the render either way); serialization
  moves to the stream-end stage. The watchdog and source semantics carry over.
- **Docs**: a second contract needs its own page — the differences above *are* the
  API.

## Verdict

Nontrivial but tractable — the honest cost is the contract split, not the code. Do not
build without a consumer whose slow loads are real and whose pages can accept
200-always below the shell line. Neither nazar.ch nor the jnana website qualifies
(SSR-04/05 measured no need). If RSC ever lands
([rsc-support.md](docs/research/postponed/rsc-support.md)), it subsumes this — flight streaming has the same
properties and this page's status/head analysis applies unchanged.
