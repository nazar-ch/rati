---
area: packages/rati/src/testing (+ reference.md §rati/testing)
needs: DATA-12 + DATA-13 (helpers mirror the final surfaces)
status: open
disposition: cut 2026-07-25 from the second-round migration feedback
---

# DATA-16 — data-layer test helpers: `controllableQuery` + a controllable producer

## Problem

`rati/testing` has `controllableSource` and nothing for `rati/data`; every new data
suite in the jnana migration hand-rolled fake responses and controllable producers —
"would have paid for itself four times over in one session."

## Scope

1. `controllableProducer<T>()` — returns `{ producer, resolve(value), reject(error),
   calls }`: a `(signal) => Promise<T>` whose settles the test drives, with call
   count/args and per-call signal exposure (aborts observable). The low-level piece;
   works with plain `query`/`collection` construction in tests.
2. `controllableQuery<T>()` — the data analogue of `controllableSource`: a real
   `query` pre-wired to a controllable producer, both returned. Sugar over (1);
   phases stepped by resolving/rejecting.
3. Mirror what real suites needed: driving a `refresh` failure onto stale data,
   stepping the debounced/reactive paths (fake timers note), asserting abort on
   supersede.
4. reference.md §rati/testing documents both, with one worked store test.
5. rati's own data tests adopt the helpers where they visibly shrink setup (light
   touch — don't rewrite DATA-09's pinned branches wholesale).

## Boundaries

- Helpers live in `src/testing/`; no production entry changes.
- No fetch/HTTP mocking (transport-neutral, like everything else — DATA-08).

## Verify

- `yarn ci fmt lint typecheck test` green.
- A store-level test written with only the new helpers (no hand-rolled producer)
  exists in the suite and reads clearly.
