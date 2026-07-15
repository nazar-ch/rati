# RF-05 — kill audit: prove the suite is not vacuous

area: packages/rati/src/router, packages/rati/src/__tests__/fuzz
needs: RF-03, RF-04
disposition: —

## Problem

A green fuzz suite proves nothing until its invariants have each caught a planted bug
(mandala-fuzz's MF-04, same reasoning). This item executes the kill register against the
full suite — every kill red, then reverted — and files the recipes.

## Scope

The planned kills, one per invariant family (RF-03's numbering); refine while executing
and file the final recipes (with their pinned `FUZZ_SEED`s — an unpinned green is no
evidence, the MF-04 finding):

1. *Rendered agreement* — make `getActiveRoute` return the first route unconditionally
   (ignore `pathRe`).
2. *URL agreement* — make `pushOrReplace` swallow the path and push the current one.
3. *State agreement / re-resolve* — drop `stateChanged` from `setPath`'s skip condition.
4. *Remount discipline* — consume the skip marker without the counter comparison
   (RF-04.1's kill, now caught by the property too — measure which bites first).
5. *Redirect discipline* — follow redirects with `push` instead of `replace` (the back
   stack grows; traversal invariants must notice).
6. *Notification coherence* — drop `emitChange` from one of `setPath`'s return paths.
7. *Teardown* — drop the history dispose call (RF-03.4's tail must catch it).

Plus the non-vacuity gate: remove the traversal verbs from the alphabet and verify
exactly the counters assert fails, nothing else.

## Boundaries

- Every kill is executed and **reverted** — the engine ships unchanged.
- A kill that survives means a mis-encoded invariant: re-encode, re-run, file the story
  (the register treats a surviving kill as the finding, not as noise).

## Verify

- All kills red (each with its recipe: mutation, seed, budget), all reverted;
  `yarn ci` green at the end. Effort ready to close.
