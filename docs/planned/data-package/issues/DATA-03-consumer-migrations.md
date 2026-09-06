---
area: cross-repo — jnana frontend (rati consumed via rati-dev); omni-admin shapes as the third case
needs: DATA-01 for the JobsListStore leg (reactive params); the other two legs can start
status: done
disposition: cut 2026-07-18 at the implementation session, from the design record's §7
---

# DATA-03 — the load-bearing consumer migrations

## Problem

The design record names its own success test: "if these don't get *shorter*, the primitives are wrong". None has been run against the shipped implementation — the primitives are validated by unit tests, not by contact with the code they were distilled from.

## Scope

The three legs, in rising order of surface exercised:

1. **Read side** — replace `FetchStore` in Jnana's `SpacesPage` / `SpaceMembersPage` (and the admin pages behind them) with `query`/`collection` + `source()` in the route scope. `SpaceMembersStore`'s per-space store map is the interesting case: a plain `Map<spaceId, Query<…>>` should fall out naturally.
2. **Reactive read side** — collapse `JobsListStore`'s six stores + manual `load()` calls into reactive queries (after DATA-01).
3. **Write side** — rebuild the `AclUserModalStore` shape (the omni-admin store that needed `FormStore` + `remoteData` + `ActiveData` simultaneously) with `form` + `mutation` + `collection`. omni-admin itself is archaeology; rebuilding the shape in Jnana (or as a worked example) is enough to run the test.

For each leg: line-count and concept-count before/after, and a dated findings note in this record's §Findings — especially anywhere the primitives forced a workaround (that is the signal DATA-04 needs).

## Boundaries

- Jnana-side commits follow Jnana's conventions, not rati's; this record only tracks the findings and any rati-side fixes they force.
- No new rati surface mid-migration: a missing capability becomes a finding in §Findings (or a new item), not an ad-hoc export.
- `JnanaList.reconcileItems` stays view-level (the design's decided relation) — the migration makes its accessors read a collection's stable items, not more.

## Verify

- Jnana's own gates green after each leg; the before/after deltas and the findings recorded in §Findings, which `issues.ts show DATA-03` prints.

## Findings (recorded 2026-07-20)

Run 2026-07-19/20 against jnana on rati 0.6.1 (PR nazar-ch/jnana#822, merged): all three legs — spaces + space-members (read), admin jobs (reactive read), the create/invite dialogs (write). The migration session committed its rati-side findings on its VM checkout and never pushed; this section reconstructs the record from the merged jnana code, not from that session's output.

**Verdict: the line-count test failed, the concept test passed.** Code lines across the 25 touched files: 1772 → 1776 (+4); per leg: read side +10, jobs −5, dialogs −1. The stores shrank where a bespoke mechanism died (`SpaceMembersStore` −27, the dialogs −18/−17), and the savings were spent re-stating the fetch boilerplate `FetchStore` used to own — `if (!res.ok) throw` + the branded-response cast, once per producer (~14 sites).

Concept count is the real result: `FetchStore`, the hand-rolled `observableSource` bridge, the dialogs' `useState` quartet, the `setX(); load()` pairing, and hand-written per-page loading/error lines all fell to imported primitives. `FetchStore` survives only on admin crons/health/job-detail — nothing blocks them, they were out of scope; it dies with them.

**What held up, verified in the merged code:**

- `Map<spaceId, Query<…>>` fell out of `queryFor()` exactly as this record predicted — a plain (non-observable) Map, reactivity riding each query's own observables.
- `source()` gating only the first render: both pages enter through an island; every later mutation-driven refresh is the instance's own phase and never re-trips a slot.
- `reactive: true` on the five job-state collections killed every paired `load()` call; the producers read `limit`/`filter` in their synchronous prefix through a private `#query()` helper, and `load()` became an honest ensure.
- `form.submit()`'s action-compatibility carried its weight: RAC's `<Form action={…}>` takes it directly, and the never-rejects contract let the dialogs close from inside the handler.
- `patchItem` carried the one optimistic list write (`rename`), with `refreshes:` reconciling after.

**The gaps, each with its receipt in the merged code and each cut into the record that owns it:** the missing single-value write seam on `query` → DATA-05; `mutation.refreshes` unable to see the call's arguments → DATA-06; `field.props` fighting `exactOptionalPropertyTypes` → DATA-07; the fetch boilerplate having no home, which is where the line savings went → DATA-08; and the bare branches a 2026-07-20 coverage map of rati's own data tests found → DATA-09.

Two more were recorded with no item cut. Keyed widgets don't take the props spread — a RAC `Select`'s `onChange` yields `Key`, not the field's type — and no change is planned, because widget kind is the component's business (docs/archive/directions-2026-07/data-package.md §5) and the hand bridge is two lines.

The integration facts the migration produced are owned jnana-side, written into that repo's own frontend-architecture memory: RAC render props run outside the caller's `observer`; RAC `Form` defaults to `validationBehavior="native"`, which blocks submit before field validators run; reactive producers must read every dependency before their first `await`; reach the API client from the fetch closure, never a field initializer, because the store graph builds before the client exists.

## The line-count test, retired (2026-07-25)

A second migration wave — three parallel legs on jnana — measured +11, +10 and +129 against this record's +4. Three independent runs, same direction, and the diagnosis holds: the primitives import a mechanism but add a surface, so lines move out of component bodies and grow in transit (the auth views lost 165 lines while their extracted state modules added 294 — a good trade the metric scores as a loss).

So this record's own success test is retired. What the migrations actually shrank: concept count and page bodies; what they bought: validation and race-correctness the old code didn't have, plus three real user-facing bugs found, one live in shipped code. Future migrations read a flat or positive line delta as "find out where the lines went," not "the primitives failed" — and no new leg gets graded on line count.

**What held up in the second wave, live-confirmed:** `source()` gating only the first resolution (refreshes never re-trip an island — "the best idea in the package"); the race guard as an invariant (deleted `FetchStore.#requestId` and `SearchStore.requestSeq` with nothing lost); `reactive: true` on the jobs collections; refresh-as-rollback.
