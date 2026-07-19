# data-package — the rati/data remains

Status: planned 2026-07-18, cut at the close of the implementation session.

The 2026-07-18 session shipped the design record's v1 in rati
([data-package.md](../../archive/directions-2026-07/data-package.md)): the legacy
`data/` layer (and its Babel decorator toolchain) removed, and the `rati/data` entry
landed with all five primitives — `query`, `collection`, `pagedCollection`, `mutation`,
`form`/`field` + the validator kit — plus the shared `itemMap` reconciler, `source()`
bridging via `instanceSource`, 48 tests in `src/__tests__/data/`, a `rati/data` section
in `docs/public/reference.md`, and the internals section. This record carries what the
session deliberately left.

## Decisions taken 2026-07-18

- **Location**: an entry under `rati/*` for the experimental stage (maintainer-chosen),
  at `src/data/` — the legacy layer was dropped rather than moved, so the dir name was
  free. Extraction to a companion package (the design's working name `rati-data`)
  remains the intent; DATA-04 owns that decision.
- **`reactive: true` deferred** (maintainer-chosen): ship `query` with
  load/refresh/debounce/abort; the reactive-params option is DATA-01, and its design
  must be cross-checked against the mandala's selective-refresh machinery (also
  maintainer-instructed — the two answer overlapping questions at different layers).
- Deviations from the design record's sketched interfaces, made during implementation
  and reflected in reference.md:
  - `Collection.refresh()` exists, delegating to `query.refresh()` — the design's own
    `refreshes: () => [spaces]` example requires it (composition rule: delegating
    members).
  - `pagedCollection`'s pages are `Query<PageResult<T, C>>` (`{ items, nextCursor }`),
    not `Query<readonly T[]>` — the cursor must ride the race-guarded settle; consumers
    read rows off `items`, pages exist for phase/error/retry.
  - `Field` gains `commit()` (the form's `commit()` needs the per-field primitive), and
    the field factory takes `FieldOptions<NoInfer<T>>` so a literal initial
    (`field('')`) can't get pinned to its literal type by a validator's generic.
  - Debounce applies to `refresh()` only; `load()` never debounces (an ensure wants
    data now) but joins an already-scheduled fetch. A cancelled scheduled refresh
    (`reset()`) resolves its coalesced promise.
  - `hasMore` is true before the first page loads (the initial unloaded tail *is*
    page 0) — structural, and `loadMore()` doubles as the initial load.

## Items

- [DATA-01 — `reactive` params for query](./issues/DATA-01-reactive-query-params.md) —
  the type-ahead/`JobsListStore` case; blocked on a design pass against the mandala's
  refresh.
- [DATA-02 — guide coverage for the data layer](./issues/DATA-02-guide-coverage.md) —
  reference.md has the section; `docs/public/guide.md` doesn't teach the model yet.
- [DATA-03 — the load-bearing consumer migrations](./issues/DATA-03-consumer-migrations.md)
  — the design's own success test: three Jnana/omni shapes must get *shorter*.
- [DATA-04 — extraction & entry-layout decision](./issues/DATA-04-extraction-decision.md)
  — companion package vs entry, `rati/mobx` absorption, forms subpath.

DATA-01 and DATA-02 are independent. DATA-03 validates everything and should follow
DATA-01 (JobsListStore needs reactive params). DATA-04 waits for DATA-03's verdict —
extract what survived contact with real consumers.

## Per-item conventions

As in the sibling records: atomic commits on the current branch, subjects prefixed
`DATA-NN:`, a `Closes: DATA-NN` trailer on the finishing commit, `vp run
rati#typecheck` + `vp lint` + `vp run rati#test` green, reference.md/internals.md in
sync. Findings out of an item's scope get a dated note appended here.

## Open questions (recorded, no items)

From the design record, still open — whichever item touches the area first weighs in,
and DATA-04 is the backstop for the rest:

- `upsert` racing an in-flight refresh: ordering guarantee (apply-after-settle vs
  last-write-wins on the reconciler). Today: last-write-wins — an upsert during a
  refresh is reconciled away if the refresh's rows disagree.
- `pagedCollection.refresh()` drift: is sequential re-anchoring enough, or does a
  truncating `restart` variant need to exist? And the contract when reactive filter
  params change (cursors invalid → reset to first page) — depends on DATA-01.
- Mutation coalescing/serialization (the legacy write-debounce) — wait for a real need.
- `FormError` field keys: `Record<string, string>` vs typed `keyof Values`.
- Async validators (server-side uniqueness) — the seam would be a promise-returning
  validator plus a per-field pending flag. Wait for need.
- Numbered pages / sparse random access: the cursor-anchor + relative-offset technique
  stays recorded in the design record (§3); not v1.
