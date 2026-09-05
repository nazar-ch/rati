---
area: packages/rati/src/data — query.ts types (+ collection facade if meaningful), test-d
needs: DATA-12 + DATA-13 (the final surfaces it brands)
status: done
disposition: cut 2026-07-25 from the second-round migration feedback (first-wave finding; type-level only)
---

# DATA-15 — brand the ready source: `Source<ReadyQuery<T>>`

## Problem

`query.source()` resolves with the live instance, typed `Source<Query<T>>` — so the resolved island prop re-narrows `data: T | undefined` even though readiness is *why* it rendered. The source only goes ready when `hasData`, and `reset()` flips it back to pending (re-tripping the island), so the stronger type is honest.

## Scope

1. `ReadyQuery<T> = Query<T> & { readonly data: T }` (exported); `Query.source()` returns `Source<ReadyQuery<T>>`. Zero runtime change.
2. Collection: decide whether an equivalent brand means anything (`items` is already always an array — likely nothing to brand; record the call either way in the record body).
3. Type tests (`*.test-d.ts`): the island-resolved prop's `data` is `T`; `reset()` still compiles against the branded reference (the brand is a read-side claim, not an immutability claim).
4. reference.md: the `source()` contract lines gain the branded type.

## Boundaries

- No runtime code. If honesty requires runtime (it shouldn't), stop and report.

## Verify

- `yarn ci fmt lint typecheck test` green; the new test-d assertions pass.
- In `examples/`, a component consuming a query-backed scope prop drops an `data ?? / !` narrowing if one exists (or a test-d proves it would).

## The collection call (2026-07-25) — no `ReadyCollection`

Decided while implementing: **collection and pagedCollection get no equivalent brand.** Their value surface is `items: readonly Item[]`, which is an array in every phase — empty before the first fetch, never `undefined` — so a brand would strip nothing and carry no information a component can act on. The narrowing DATA-15 removes simply never existed on that side.

The tempting stronger claim — "ready means non-empty" — is *false*: a fetch that resolves `[]` is a legitimate ready state, and the source publishes the instance for it. Branding `items` as non-empty would be a lie the engine cannot keep.

`reconciled` has no `source()` at all (the backing query owns the fetch state), so the question does not arise there. The decision is pinned by a test in `packages/rati/src/__tests__/data/query.test-d.ts` (`describe('collection.source()')`), which asserts the unbranded `Source<Collection<Row, Row>>` — so a future brand has to come with a deliberate edit to that assertion.

## What landed

- `ReadyQuery<T> = Query<T> & { readonly data: T }`, exported from `rati/data`; `Query.source(): Source<ReadyQuery<T>>`. One cast in `createQuery`'s `source()`, zero runtime change.
- `packages/rati/src/__tests__/data/query.test-d.ts` — the brand's shape, its assignability back to `Query<T>`, every mutator still reachable through it, the island-resolved prop's `data` read with no narrowing, and the collection call.
- reference.md §`rati/data` "The scope seam" carries the branded contract.
- The examples do not use `rati/data`, so the "drops a narrowing" check is the test-d one (`Props['row']['data']['title']`), per the Verify's alternative.
