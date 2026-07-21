---
area: packages/rati/src/__tests__/fuzz/router.commands.fuzz.test.tsx (the "never exercised" loop), scripts/ci.ts (stage split, context only)
needs: — (independent)
status: done
disposition: filed 2026-07-17 (found by SSR-14/15's gate run, measured then; re-fired 2026-07-17 during the RF-07 correction round on a tree touching no traversal code). Decision pending — recommendation below.
---

# RF-09 — the coverage guard flakes at the budget its comment vouches for

## Problem

The command-fuzz suite's coverage guard asserts that all sixteen listed shapes were
exercised, and its comment claims every one is reachable at the default `fuzz(25)`
budget. Measured: 50 runs at that budget, half on a clean checkout, 7 red — ~14% per
run, always on the two conspiracy shapes (`a traversal landed on a stale shallow entry`,
`a traversal stepped between two same-URL entries differing in state`; both need a
shallow entry armed, then navigated away from, then traversed back onto). A guard that
cries wolf at 14% teaches the reader to re-run a red `test` stage, which is the failure
mode it was built to prevent, inverted. The deep stage (`FUZZ_RUNS=500`) reaches every
shape reliably.

## Options and recommendation

1. **Per-shape floor** — keep the guard at the tiny budget but only for the shapes it
   reliably reaches, with the two conspiracy shapes exempted. Splits the list into two
   classes the reader has to track, and the exempt half is exactly the half most worth
   guarding (they exist because RF-03.3's shapes are hard to reach by accident).
2. **Weight the generator toward the conspiracy** — biases the day-to-day distribution
   the property explores to satisfy its own meta-check; what the fuzz explores should be
   the model's business, not the guard's.
3. **Assert the guard only at the deep budget** (recommended) — the loop runs (so the
   counters stay exercised and a deep run still fails loudly) but only *asserts* when
   the budget is the deep one (read the same env `fuzz()` reads). Nothing is lost at the
   gate: `yarn ci` always runs the `fuzz` stage at `FUZZ_RUNS=500`, where every shape is
   reliably reachable — the guard keeps catching a harness that stopped generating a
   shape on every gate run, and stops failing `test`-stage runs it cannot honestly
   judge. The comment then states a true claim.

## Scope

1. Gate the sixteen-shape assertion loop on the deep budget; keep counting at every
   budget.
2. Rewrite the `:117` comment to say what is actually true: reachable at the deep
   budget, asserted there; the default budget only counts.
3. The README findings entry (2026-07-16 §coverage-guard note) gets a pointer to this
   item's resolution.

## Boundaries

- The alphabet and the model are untouched — this is about where the meta-check runs,
  not what the property explores.
- No new suite: the deep stage already runs this file.

## Verify

- 50 runs of the suite at the default budget: zero coverage-guard reds.
- One deep run (`FUZZ_RUNS=500`): the guard asserts and passes.
- Kill: with a shape's generator removed from the alphabet (executed once, reverted),
  the deep run's guard goes red naming it.
