# data-package — the rati/data remains

Status: planned 2026-07-18, cut at the close of the implementation session.

The 2026-07-18 session shipped the design record's v1 in rati
([data-package.md](docs/archive/directions-2026-07/data-package.md)): the legacy
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
- **`reactive: true`** — deferred 2026-07-18, then **shipped 2026-07-19 (DATA-01)** after
  the design pass against the mandala's selective refresh (the line: URL params → scope,
  store observables → reactive query). A per-primitive MobX `Reaction` tracks the producer's
  synchronous prefix during the real fetch and re-runs `refresh()` (coalesced by `debounce`);
  `pagedCollection` resets to the first page instead (cursors invalidate). Design pass +
  the four cross-checks: [data-package.md §DATA-01](docs/archive/directions-2026-07/data-package.md#data-01--reactive-params-design-pass-2026-07-19).
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

The records are the tracker — each carries its own `status:` field
(`grep -l 'status: open' issues/*.md` is the open list). This map is narrative and
ordering only:

- [DATA-01 — `reactive` params for query](issues/DATA-01-reactive-query-params.md) —
  the design pass + `reactive` on `query`/`collection`/`pagedCollection`, tests,
  reference/design-record docs (2026-07-19).
- [DATA-02 — guide coverage for the data layer](issues/DATA-02-guide-coverage.md) —
  `guide.md` teaches the data-layer model end to end (2026-07-19).
- [DATA-03 — the load-bearing consumer migrations](issues/DATA-03-consumer-migrations.md)
  — all three legs ran on jnana (PR nazar-ch/jnana#822, merged, 2026-07-20); the verdict
  and findings below.
- [DATA-04 — extraction & entry-layout decision](issues/DATA-04-extraction-decision.md)
  — companion package vs entry, `rati/mobx` absorption, forms subpath.
- [DATA-05 — a single-value write seam for `query`](issues/DATA-05-query-write-seam.md)
  — `set`/`patch` (through `onSuccess`, so a collection's map stays coherent), tests,
  reference.md (2026-07-20).
- [DATA-06 — `refreshes` sees the mutation call's arguments](issues/DATA-06-refreshes-args.md)
  — the declaration receives the call's args at both fire sites; keyed tests pin the
  FND-106 choreography with DATA-05 (2026-07-20).
- [DATA-07 — `field.props` under `exactOptionalPropertyTypes`](issues/DATA-07-field-props-exact-optional.md)
  — `errorMessage` is absent while clean, genuinely `?:` (2026-07-20).
- [DATA-08 — the fetch-boilerplate helper decision](issues/DATA-08-fetch-helper-decision.md)
  — where the ok-check + `json()` + error mapping lives; **maintainer call**, blocked on it.
- [DATA-09 — pin the unpinned data branches](issues/DATA-09-unpinned-branches.md)
  — test-only: the branches the 2026-07-20 coverage map found bare.

DATA-05 and DATA-06 were coupled through jnana's ◊FND-106: restoring the optimistic
retention hop needs the seam (05) *and* the on-error recovery refresh of a keyed query
(06) — jnana can unskip HI-03 after the next rati release. DATA-04 stays last — it should
extract the surface *after* DATA-08's answer lands, not before.

## DATA-03 findings — the jnana migration (recorded 2026-07-20)

Run 2026-07-19/20 against jnana on rati 0.6.1 (PR nazar-ch/jnana#822, merged): all three
legs — spaces + space-members (read), admin jobs (reactive read), the create/invite
dialogs (write). The migration session committed its rati-side findings on its VM
checkout and never pushed; this section reconstructs the record from the merged jnana
code, not from that session's output.

**Verdict: the line-count test failed, the concept test passed.** Code lines across the
25 touched files: 1772 → 1776 (+4); per leg: read side +10, jobs −5, dialogs −1. The
stores shrank where a bespoke mechanism died (`SpaceMembersStore` −27, the dialogs
−18/−17), and the savings were spent re-stating the fetch boilerplate `FetchStore` used
to own — `if (!res.ok) throw` + the branded-response cast, once per producer (~14
sites). Concept count is the real result: `FetchStore`, the hand-rolled
`observableSource` bridge, the dialogs' `useState` quartet, the `setX(); load()`
pairing, and hand-written per-page loading/error lines all fell to imported primitives.
`FetchStore` survives only on admin crons/health/job-detail — nothing blocks them, they
were out of scope; it dies with them.

**What held up, verified in the merged code:**

- `Map<spaceId, Query<…>>` fell out of `queryFor()` exactly as the item predicted — a
  plain (non-observable) Map, reactivity riding each query's own observables.
- `source()` gating only the first render: both pages enter through an island; every
  later mutation-driven refresh is the instance's own phase and never re-trips a slot.
- `reactive: true` on the five job-state collections killed every paired `load()` call;
  the producers read `limit`/`filter` in their synchronous prefix through a private
  `#query()` helper, and `load()` became an honest ensure.
- `form.submit()`'s action-compatibility carried its weight: RAC's `<Form action={…}>`
  takes it directly, and the never-rejects contract let the dialogs close from inside
  the handler.
- `patchItem` carried the one optimistic list write (`rename`), with `refreshes:`
  reconciling after.

**The gaps, each with a receipt in the merged code:**

1. **`query` has no single-value write seam.** The members payload is a composite
   object, so it's a `query` — and `Query` exposes only readonly `data`, so
   `updateHistoryRetention` lost its optimistic hop (a shipped behavior; the HI-03
   store test is `describe.skip`-ed, jnana ◊FND-106). → DATA-05.
2. **`mutation.refreshes` can't see the call's arguments.** A dependent keyed by the
   call (`queryFor(spaceId)`) can't be declared, so all five member mutations
   `await …refresh()` by hand inside `perform`. Three consequences: the refresh rides
   the mutation's `isPending`, a refresh failure dishonestly fails a succeeded
   mutation, and the `onError: 'refresh'` recovery can never reach a keyed dependent —
   which DATA-05's optimistic patches will need. → DATA-06.
3. **The fetch boilerplate has no home.** The ok-check + `json()` + cast is where the
   line savings went; the design record listed a typed fetch helper, and the migration
   correctly didn't invent one mid-flight (this record's own boundary). Whether it
   belongs in transport-neutral `rati/data`, in jnana, or nowhere is a maintainer
   call. → DATA-08.
4. **`field.props` fights `exactOptionalPropertyTypes`.** `FieldProps.errorMessage` is
   `string | undefined`, so spreading it into a `?:`-typed consumer prop rejects;
   jnana had to widen `TextFieldProps.errorMessage` by hand. → DATA-07.
5. **Keyed widgets don't take the props spread** (a RAC `Select`'s `onChange` yields
   `Key`, not the field's type). Recorded, no change planned: widget kind is the
   component's business (design §5), and the hand bridge is two lines.
6. **Integration facts, owned jnana-side** (written into its
   `.claude/frontend-architecture.md`): RAC render props run outside the caller's
   `observer`; RAC `Form` defaults to `validationBehavior="native"`, which blocks
   submit before field validators run; reactive producers must read every dependency
   before their first `await`; reach the API client from the fetch closure, never a
   field initializer (store graph builds before the client exists).

Separately, a 2026-07-20 coverage map of rati's own data tests found unpinned branches
(sync throw inside the reactive `track`, `itemMap`'s insert-existing-key/`clear`/custom
`equals` paths, upsert racing a reconcile, unsubscribe actually stopping) → DATA-09.

## Per-item conventions

As in the sibling records: atomic commits on the current branch, subjects prefixed
`DATA-NN:`, the record's `status: open` → `done` in the finishing commit, `vp run
rati#typecheck` + `vp lint` + `vp run rati#test` green, reference.md/internals.md in
sync. Findings out of an item's scope get a dated note appended here.

## Open questions (recorded, no items)

From the design record, still open — whichever item touches the area first weighs in,
and DATA-04 is the backstop for the rest:

- `upsert` racing an in-flight refresh: ordering guarantee (apply-after-settle vs
  last-write-wins on the reconciler). Today: last-write-wins — an upsert during a
  refresh is reconciled away if the refresh's rows disagree.
- `pagedCollection.refresh()` drift: is sequential re-anchoring enough, or does a
  truncating `restart` variant need to exist? (The reactive-filter contract is now
  settled — DATA-01 resets to the first page; debounce for that reset is not wired in v1,
  the one recorded gap.)
- Mutation coalescing/serialization (the legacy write-debounce) — wait for a real need.
- `FormError` field keys: `Record<string, string>` vs typed `keyof Values`.
- Async validators (server-side uniqueness) — the seam would be a promise-returning
  validator plus a per-field pending flag. Wait for need.
- Numbered pages / sparse random access: the cursor-anchor + relative-offset technique
  stays recorded in the design record (§3); not v1.
