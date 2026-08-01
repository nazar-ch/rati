---
area: packages/rati/src/testing/stores.tsx (+ reference docs)
needs: nothing (cut 2026-07-20 from the DX-06 frictions)
status: done
disposition: the honest value must type-check wherever the fake does
---

# DX-09 — a real RouterStore fits a `PartialStores` slot

## Problem

The DX-06 migration's one rati-side friction, inverted from the item's expectation: a
consumer that types its container's `router` against the app's exact route tuple
(`RouterStore<typeof routes>`) makes `Partial<RouterStore<typeof routes>>` demand that
tuple — so a *real* `RouterStore` built over a minimal local table is rejected, while a
`{ navigate: vi.fn(), path, search, searchParams }` fake sails through (none of those
fields is table-typed). The seam's whole point is that the honest value beats the
imitation; here the type system enforces the opposite. Jnana's
`anonymousShell.browser.test.tsx` kept its typed partial as a survivor because of exactly
this.

The only invariantly-checked member is the `routes: T` property — `navigate`/`replace`/
`getPath` are method-syntax (bivariant), so a `RouterStore<localTable>` is assignable to
bare `RouterStore` (default `readonly GenericRouteType[]`). That makes the fix a type-level
union arm, no runtime change.

## Scope

1. `PartialStores<S>`: a slot whose declared type is a RouterStore additionally accepts
   `RouterStore` (any table) — keyed on the slot's *value type*, not the `router` key name,
   so a differently-named slot gets the same treatment. Partial fakes keep checking against
   the app's own store type; non-router slots are untouched.
2. Type tests (`testing.test-d.ts`): the Jnana shape — an app-tuple-typed `router` slot
   takes a store over a local table with no cast; the router-shaped partial still fits; a
   mistyped slice and an undeclared store are still errors.
3. Docs rider, same source (the DX-06 note's second friction): the reference's
   `rati/testing` section gains the consumer note that a `rati/*` entry new to a Vitest
   **browser**-mode project must be added to `optimizeDeps.include` — an un-prebundled
   entry triggers a mid-run re-optimization that reads as a component crash.

## Boundaries

- No runtime change — `storesWrapper`/`createTestRouter` already widen with the one
  sanctioned cast; this is assignability only.
- Not a general variance fix for consumer store classes generic over app-exact types —
  RouterStore is the one store rati owns and the one `GlobalStores` names.
- Jnana's adoption of the loosened slot (retiring the `anonymousShell` survivor if its
  author wants the honest value) waits for the next release; not this item's scope.

## Verify

- `yarn ci` green; the new test-d cases pass, and the DX-06 repro error is gone.
- The pre-fix failure is pinned in the record: the exact `Types of property 'routes' are
  incompatible … Target requires N element(s)` error reproduced in rati's own test tree
  before the union arm landed.
