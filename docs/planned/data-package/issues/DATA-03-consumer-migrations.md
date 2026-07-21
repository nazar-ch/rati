---
area: cross-repo — jnana frontend (rati consumed via rati-dev); omni-admin shapes as the third case
needs: DATA-01 for the JobsListStore leg (reactive params); the other two legs can start
status: done
disposition: cut 2026-07-18 at the implementation session, from the design record's §7
---

# DATA-03 — the load-bearing consumer migrations

## Problem

The design record names its own success test: "if these don't get *shorter*, the
primitives are wrong". None has been run against the shipped implementation — the
primitives are validated by unit tests, not by contact with the code they were
distilled from.

## Scope

The three legs, in rising order of surface exercised:

1. **Read side** — replace `FetchStore` in Jnana's `SpacesPage` / `SpaceMembersPage`
   (and the admin pages behind them) with `query`/`collection` + `source()` in the
   route scope. `SpaceMembersStore`'s per-space store map is the interesting case: a
   plain `Map<spaceId, Query<…>>` should fall out naturally.
2. **Reactive read side** — collapse `JobsListStore`'s six stores + manual `load()`
   calls into reactive queries (after DATA-01).
3. **Write side** — rebuild the `AclUserModalStore` shape (the omni-admin store that
   needed `FormStore` + `remoteData` + `ActiveData` simultaneously) with `form` +
   `mutation` + `collection`. omni-admin itself is archaeology; rebuilding the shape in
   Jnana (or as a worked example) is enough to run the test.

For each leg: line-count and concept-count before/after, and a dated findings note in
the README — especially anywhere the primitives forced a workaround (that is the
signal DATA-04 needs).

## Boundaries

- Jnana-side commits follow Jnana's conventions, not rati's; this record only tracks
  the findings and any rati-side fixes they force.
- No new rati surface mid-migration: a missing capability becomes a README finding
  (or a new item), not an ad-hoc export.
- `JnanaList.reconcileItems` stays view-level (the design's decided relation) — the
  migration makes its accessors read a collection's stable items, not more.

## Verify

- Jnana's own gates green after each leg; the before/after deltas recorded in the
  README with the findings.
