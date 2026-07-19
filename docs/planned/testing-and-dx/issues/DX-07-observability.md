# DX-07 — `dataTrace` + `Step` displayName

area: packages/rati/src/debug/index.ts, src/util/navTrace.ts (pattern), 
      src/mandala/{resolver.tsx,mandala.tsx}, docs
needs: — (independent; any time)
disposition: cut 2026-07-19 from dx-and-tooling.md §Resolution tracing + §DevTools naming

## Problem

Two small observability gaps, verified at cut:

- `navTrace` (the `rati/debug` entry) has no data-side sibling: per-island level
  starts/settles with timings are invisible, so tuning level placement (the "where a prop
  is declared" performance knob) is guesswork.
- Islands carry a `displayName` (`Island(…)`/`Route(…)`, `mandala/mandala.tsx:242`) but the
  inner `Step` components don't — the DevTools tree shows anonymous `Step`s.

## Scope

1. **`dataTrace`** on the `rati/debug` entry, following `navTrace`'s pattern exactly
   (enable/disable surface, console formatting, zero cost when off): per island — level
   start, per-cell settle (ready/error) with durations, refresh cause where cheap
   (initial / param change / refresh / retry). Read `navTrace.ts` first and match its
   conventions; the two should read as siblings.
2. **`Step` displayName** — `Step(users,tree)`-style naming (level keys), set where `Step`
   is defined (`resolver.tsx:334`), composing with the island's existing label
   (`setScopeLabel` machinery if it helps). Dev-only cost is fine; production strings should
   not bloat (check what the mandala already does for its wrapper name under minification).
3. **Docs:** the debug entry's reference section gains `dataTrace`; one line for the
   DevTools naming in internals.md.

## Boundaries

- No devtools UI, no structured trace export — console tracing at `navTrace` parity only.
- No tracing in `src/data/` (separate layer, out of this effort).
- Zero behavior change when tracing is off; no new always-on allocations in the resolver
  hot path.

## Verify

- `yarn ci` green.
- A test drives an island with `dataTrace` enabled and asserts the emitted lines' shape
  (the `navTrace` tests are the template — mirror their altitude).
- Manual: React DevTools over `examples/demo` shows named `Step`s (screenshot or a line in
  the commit message saying it was looked at).
