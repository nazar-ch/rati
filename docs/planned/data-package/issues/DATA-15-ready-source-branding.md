---
area: packages/rati/src/data — query.ts types (+ collection facade if meaningful), test-d
needs: DATA-12 + DATA-13 (the final surfaces it brands)
status: open
disposition: cut 2026-07-25 from the second-round migration feedback (first-wave finding; type-level only)
---

# DATA-15 — brand the ready source: `Source<ReadyQuery<T>>`

## Problem

`query.source()` resolves with the live instance, typed `Source<Query<T>>` — so the
resolved island prop re-narrows `data: T | undefined` even though readiness is *why*
it rendered. The source only goes ready when `hasData`, and `reset()` flips it back
to pending (re-tripping the island), so the stronger type is honest.

## Scope

1. `ReadyQuery<T> = Query<T> & { readonly data: T }` (exported); `Query.source()`
   returns `Source<ReadyQuery<T>>`. Zero runtime change.
2. Collection: decide whether an equivalent brand means anything (`items` is already
   always an array — likely nothing to brand; record the call either way in the
   record body).
3. Type tests (`*.test-d.ts`): the island-resolved prop's `data` is `T`; `reset()`
   still compiles against the branded reference (the brand is a read-side claim,
   not an immutability claim).
4. reference.md: the `source()` contract lines gain the branded type.

## Boundaries

- No runtime code. If honesty requires runtime (it shouldn't), stop and report.

## Verify

- `yarn ci fmt lint typecheck test` green; the new test-d assertions pass.
- In `examples/`, a component consuming a query-backed scope prop drops an
  `data ?? / !` narrowing if one exists (or a test-d proves it would).
