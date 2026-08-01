---
area: packages/rati/src/data — mutation.ts (+ reference.md)
needs: nothing; pairs with DATA-05 for jnana ◊FND-106's recovery path
status: done
disposition: cut 2026-07-20 from the DATA-03 findings (gap 2)
---

# DATA-06 — `refreshes` sees the mutation call's arguments

## Problem

`MutationOptions.refreshes` is niladic (`() => deps`), while `optimistic` already
receives the call's arguments. A dependent keyed by the call — jnana's
`queryFor(spaceId)` — can't be declared, so all five member mutations in the DATA-03
migration `await this.queryFor(spaceId).refresh()` by hand inside `perform`. That
workaround has three real costs:

- the refresh rides the mutation's `isPending` (the button spins through the refetch);
- a refresh failure rejects a mutation whose HTTP call succeeded;
- the `onError: 'refresh'` recovery can never reach a keyed dependent — exactly what
  DATA-05's optimistic patches on keyed queries will need to roll back.

## Scope

`refreshes?: (...args: Args) => ReadonlyArray<{ refresh(): Promise<void> }>` — pass
the call's arguments through at both fire sites (success and the `'refresh'` error
path). Strictly widening: every existing `() => [deps]` still typechecks.

## Boundaries

- Refreshes stay fired-not-awaited; no change to the choreography, only to what the
  declaration can see.
- `onError` callback semantics untouched (it already receives the args).

## Verify

- Tests: a dependent selected by the call's own argument is refreshed on success and
  on failure under the default `onError: 'refresh'` (the keyed-recovery scenario the
  2026-07-20 coverage map found untested).
- reference.md's `mutation` row/prose reflects the signature.
