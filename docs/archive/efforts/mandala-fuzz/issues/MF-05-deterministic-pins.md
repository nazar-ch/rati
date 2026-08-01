---
area: packages/rati/src/__tests__/mandala
needs: —
status: done
disposition: —
---

# MF-05 — deterministic pins: the gaps enumerated in the strategy doc

## Problem

The 13 tests that landed with selective refresh + SSR sources cover happy paths and headline
behaviors; the specific gaps (twelve pins as of this writing) are enumerated in
[mandala-testing.md](docs/archive/mandala-testing.md) §"Deterministic pins" — races
(superseded refresh, remount mid-flight), semantics (transitive cascade with mid-chain cutoff,
lazy read-set re-recording, hydrated-cell asymmetry, `equals` on cascade re-runs), SSR /
StrictMode edges, and the Suspense-produced situations (re-suspension of committed content,
unmount-while-suspended, the mid-tree source-pending asymmetry) cataloged in
`packages/rati/src/__tests__/suspense-situations.md` — read that catalog first; it names each
pin's contract and its altitude boundary. These pins guard the code that exists *today* and are
independent of the fuzz harness — they can land first or in parallel.

## Scope

1. Implement the pins from the strategy doc (its numbered list is the specification; read the
   implementation note
   `docs/archive/directions-2026-07/mandala-refresh-and-ssr-sources.md` for the behaviors each
   pins). Homes: `__tests__/mandala/scopeControls.test.tsx` (1–6, 9, 11–12),
   `__tests__/mandala/islandSsrSources.test.tsx` (7), a new
   `__tests__/mandala/strictModeLifecycle.test.tsx` if 8 doesn't fit an existing file, and a
   new `__tests__/mandala/suspenseEdges.test.tsx` for 10 (hook-load re-suspension) if it
   doesn't fit `island.test.tsx`.
2. Each pin carries a **kill note** — a comment naming the one-line source mutation that makes
   it fail — executed once at authoring and reverted (jnana discipline; keeps MF-04's register
   focused on the fuzz harness).
3. Where a pin documents an intentional asymmetry (e.g. hydrated cells joining the cascade only
   after their first re-run), assert the *documented* behavior and reference the doc — the pin
   is a change detector, not an endorsement.

## Boundaries

- No fuzz-harness files — that's the MF-01/02/03 lane; this item runs independently.
- The altitude rule binds here too: pin behaviors stated in the public JSDoc / design docs, not
  internals.
- No engine changes. A pin that *fails against current code* has found a real bug: pin the
  expected-per-docs behavior as `test.fails`, report at the checkpoint, and let the user decide
  the fix — don't silently patch the engine under a testing item.

## Verify

- `vp run rati#test src/__tests__/mandala/` green (or `test.fails`-marked findings reported).
- Every pin's kill note executed once (red) and reverted (green) — noted in the commit message.
- `vp run rati#typecheck:test` + `vp lint` green.
