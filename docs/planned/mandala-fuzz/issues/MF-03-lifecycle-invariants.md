# MF-03 — lifecycle ledger under fuzz + StrictMode variant

area: packages/rati/src/__tests__/fuzz
needs: MF-01, MF-02
disposition: —

## Problem

The refresh work restructured source lifetimes: a cascade can swap a source mid-flight (the
level's `sources` array re-keys), Step teardown keeps entries the live bucket still holds, and
the mandala's unmount sweep is the backstop (see
`docs/archive/directions-2026-07/mandala-refresh-and-ssr-sources.md` §"Source-lifetime
rework"). Leaks and double-attaches in this machinery are exactly the class a fuzz ledger
catches and example tests miss — invariant 6 of
[mandala-testing.md](../../../archive/mandala-testing.md) §"Invariants".

## Scope

1. Extend the harness's controllable sources with a per-instance ledger (attach/detach counts +
   order); assert after every command: no entry attached twice concurrently, no detached source
   still feeding renders. Keep the S8 boundary from
   `packages/rati/src/__tests__/suspense-situations.md`: when a mid-tree source drops to
   pending, whether deeper levels' sources stay attached through the window is the engine's
   choice — the ledger asserts bounds (no double attach, balanced at teardown), never the
   churn-free behavior itself.
2. At final unmount (the `finally` of every run): every attach matched by a detach — a leak fails
   the run even when all mid-run asserts passed.
3. A `.provide()` spec variant: the provided value records build/dispose; assert
   dispose-before-detach (the value disposes while its sources are still attached) and
   dispose/rebuild pairing across refresh-driven rebuilds — this is contract (the documented
   lifecycle promise), not mechanics.
4. A StrictMode variant of the MF-01 smoke property (wrap in `<StrictMode>`): same invariants
   hold under React's double-mount; the ledger must balance through the mount → cleanup → mount
   sequence.

## Boundaries

- Same harness files as MF-02 (one serialization lane — run in sequence with it).
- StrictMode applies to the *smoke* property only in this item; promoting the full command model
  to StrictMode is a later call (record a note if it looks cheap).
- Altitude rule binds; no engine changes (findings → deterministic pin + checkpoint report).

## Verify

- `vp run rati#test src/__tests__/fuzz/` and `FUZZ_RUNS=500` green.
- Sanity kill (executed once, reverted; the durable register is MF-04): in
  `src/mandala/resolver.tsx`, invert the swap-aware detach condition (always detach on a
  `[sources]` deps change) — the ledger property must fail.
- `vp run rati#typecheck:test` + `vp lint` green.
