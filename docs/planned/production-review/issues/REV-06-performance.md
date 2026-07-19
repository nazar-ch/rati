# REV-06 — performance

area: render-path hot spots: mandala/{channel,resolver,mandala}, scope/source snapshot
      discipline, router store notifications, Link active-state, scrollRestoration;
      per-entry bundle cost
needs: — (best after scope-and-island lands; REV-03's size measurement precedes the size
       half if both run)
disposition: cut 2026-07-19; production-review lens 6

## Problem

rati's pitch includes "components receive clean, fully-resolved props" — that promise is
hollow if the machinery re-renders subtrees on every unrelated tick. The uSES architecture
makes snapshot identity discipline load-bearing (an unstable `getSnapshot` is a re-render
storm or an infinite loop), and nobody has profiled the framework as a whole or measured
what each entry costs a consumer's bundle.

## Scope

1. **Snapshot stability audit.** Every `useSyncExternalStore` pair in the tree
   (`Source`, channels, RouterStore, controls): `getSnapshot` returns identity-stable
   values between changes (no per-call allocation), notifications fire only on real change
   (the one-notification-per-`setPath` contract generalized — where else could a no-op
   notify?). Read + targeted render-count tests.
2. **Re-render blast radius, measured.** Instrument (React Profiler / render counters) the
   real scenarios: one source emitting under an island with many consumers — who
   re-renders? A param change on one route — does the whole `Router` subtree churn? A
   `useScope` consumer next to an unrelated one — isolated? An island resolving — how many
   times does the component render before settling (each render count asserted where it is
   a contract, recorded where it is a baseline)?
3. **Resolver hot path:** per-render allocations in `Step`/cell machinery (object/array
   churn on plain re-renders), the level-key iteration, `useScope` lookup cost. Kept
   buckets (SI-03) doubling retained memory — measured, and released on commit.
4. **Link at scale:** N `Link`s' active-state work per navigation (each subscribes?
   re-resolves `href`? — a 500-link page is normal); scroll restoration bookkeeping per
   entry over long sessions.
5. **Bundle cost per entry**, building on REV-03's scratch-consumer rig: minified+gzip for
   `rati`, `/ssr` client-side, `/data` (measured though excluded from review — it ships),
   versus the peer field (rough React Router / TanStack numbers as context, not as a
   target). Recorded as a baseline table in the findings note.
6. **SSR throughput smoke:** `renderApp` requests/sec on the gallery (one number, one
   machine, recorded) — the baseline future changes diff against.

## Boundaries

- `src/data/` code excluded from review (bundle number only).
- No optimization beyond fix-or-file: an unstable snapshot or accidental O(n²) is a fix;
  an architectural cost (waterfall-by-design) is documentation, not a finding.
- No micro-benchmark theater — numbers recorded are baselines and contracts, each with the
  command that reproduces it.

## Verify

- The baseline table (bundle sizes, render counts, SSR throughput) committed to the
  findings note with reproduction commands.
- Render-count contracts pinned as tests only where the count is genuinely contractual
  (the altitude rule: a legitimate optimization must not fail them).
- `yarn ci` green after fixes.
