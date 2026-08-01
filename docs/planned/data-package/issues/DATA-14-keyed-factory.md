---
area: packages/rati/src/data — new keyed.ts (+ reference.md)
needs: nothing hard; examples read better after DATA-13 (reconciled/store-class pattern)
status: done
disposition: cut 2026-07-25 from the second-round migration feedback (first wave asked for it; second round demoted it to the thin map it is)
---

# DATA-14 — `keyed()`: the lazy per-key instance map

## Problem

Every keyed resource hand-rolls `Map<key, instance>` with lazy get-or-create — jnana's
`SpaceMembersStore` did, `ResourcePool` is a near-twin, and `mutation.refreshes` wants
something to point at (`refreshes: (spaceId) => [this.members.get(spaceId)]`). ~20
library lines delete that everywhere.

Deliberately **thin and primitive-agnostic** — the factory returns *whatever you
build*: a `query` of a composite payload, a `collection`, a `pagedCollection`, or a
store class stitching several (the blessed pattern once DATA-13's `reconciled`
exists). It is a lazy instance map, **not a cache**: no eviction, no TTL, no
cross-key identity (see DATA-13 boundaries; unbounded key spaces want a selection,
not this — DATA-17's page carries that judgement).

## Scope

1. `keyed<K, I>(factory: (key: K) => I): Keyed<K, I>` with:
   - `get(key): I` — get-or-create; the same instance for the same key forever
     (per-key identity is the map's contract);
   - `peek(key): I | undefined` — no creation;
   - `reset(): void` — drop every instance (sign-out); it does *not* call into the
     instances (dropping the references is the semantics; callers reset instances
     they still hold).
   Backing store observable enough that `peek` is reactive (an observable map);
   key type `K` constrained to something Map-safe (string/number — decide with a
   type test; branded strings must pass).
2. Worked examples in reference.md: a keyed composite `query`, a keyed
   `collection`, a store class per key, and the `refreshes` wiring.
3. Tests: get-or-create identity, peek reactivity, reset, branded-key typing.

## Boundaries

- No eviction/TTL/LRU — v1 is a map.
- No iteration API beyond what a real need demands (start without; add `keys()` only
  if an example needs it).
- Nothing here touches query/collection internals.

## Verify

- `yarn ci fmt lint typecheck test` green.
- `refreshes: (spaceId) => [this.members.get(spaceId)]` compiles and refreshes the
  right instance in a test.
