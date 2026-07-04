# The companion data package — design options

Design for the successor of the legacy `data/` layer (`remoteData`, `ActiveData`,
`apiUtils`, today shipped via `rati/mobx`) and of Jnana's `FetchStore` family. These
primitives served a CRUD web app well (that app is gone); Jnana re-grew a leaner version
(`FetchStore` + ad-hoc optimistic updates + `JnanaList.reconcileItems`). This doc distills
both generations into one package.

## Ground rules

- **A companion package, not core.** Working name **`rati-data`** (alternatives:
  `rati-remote`, `rati-crud` — both narrower than the content). Peer-deps: `rati`, `mobx`.
  MobX is fine here — this package is *for* MobX-shaped apps; core stays uSES-only.
- **Instance-owned data.** Each query/collection is an object living in the app's store
  graph; sharing happens by sharing the instance. No keyed shared cache, no normalized
  store — deliberately out of scope to keep the design iterable. (The ref-counting layer,
  `ResourceContainer`, may move to rati core separately — see
  [improvements.md §5](./improvements.md).)
- **Phases are data; presentation is the mandala's.** The package reports honest phases
  (`loading` vs `refreshing`, timestamps). Pending-indication delay
  (`indicatePendingAfterTimeoutMs`) and stale-content display live in the island
  ([improvements.md §2](./improvements.md)) — the package never owns a timer that exists
  only to decide what a user sees.
- **Bridges to core via `Source`.** Every primitive exposes a `source()` (built on
  `observableSource`), so a scope's `.load()` can await first readiness and the island's
  loading/error slots cover the initial load. After that, components observe the instance
  directly — fine-grained MobX reactivity, no island re-resolution.

## 1. `query` — the refreshable unit (FetchStore matured)

The atom: one async producer, one current value, honest phases, race-guarded.

```ts
type QueryPhase = 'idle' | 'loading' | 'ready' | 'refreshing' | 'error';

interface Query<T> {
    readonly data: T | undefined;          // survives refresh — stale until replaced
    readonly phase: QueryPhase;
    readonly error: SourceError | null;
    readonly isPending: boolean;           // loading || refreshing
    load(): Promise<void>;                 // first load or re-load; deduped while in flight
    refresh(): Promise<void>;              // like load(), but phase = 'refreshing' (data kept)
    reset(): void;
    source(): Source<Query<T>>;            // pending until first 'ready'; then this instance
}

function query<T>(producer: (signal: AbortSignal) => Promise<T>, options?: QueryOptions): Query<T>;
```

Decisions folded in:

- **`data` survives `refresh()`** — the single biggest UX difference from `FetchStore`,
  which nulls nothing but conflates "first load" and "reload" in one `isLoading`. The
  `loading`/`refreshing` split is exactly what the mandala's stale-display needs.
- **Race guard built in** (the `requestId` pattern `FetchStore` and `remoteData` both
  carry) — not an option, an invariant. `AbortSignal` passed to the producer so superseded
  requests can actually be cancelled, mirroring the core proposal for scope loads.
- **Errors normalize to `SourceError`** (`toSourceError`), so a query error and an island
  error are the same shape and the same `code` switch works everywhere.
- **Debounce as an option** — `remoteData`'s real value was coalescing keystroke-driven
  calls with all callers receiving the final result. That survives as
  `options.debounce: { waitMs, maxWaitMs }`; the pending-indication half of `remoteData`
  does not (mandala's job).

**Composition vs inheritance.** Jnana uses both today (`SpacesListStore extends
FetchStore`; `JobsListStore` composes six of them). Recommendation: design for
**composition** — `query()` returns a plain observable object, and a domain store holds
queries as fields. Subclassing couples the domain store's API to the primitive's and breaks
down the moment a store needs two queries (as `JobsListStore` proves). No class export
needed; a store that wants to *be* a query can still expose delegating members.

**Reactive parameters** — the "reactive" requirement. `JobsListStore` re-reads
`this.limit`/`this.filter` inside its producers but must call `load()` manually after each
setter. Option: an `autorun` mode where the producer's observable reads are tracked and a
change re-runs it (debounced):

```ts
const jobs = query((signal) => api.jobs.$get({ query: { limit: String(this.limit) } }, { signal }), {
    reactive: true,           // MobX reaction over the producer's own observable reads
    debounce: { waitMs: 150 },
});
// setLimit(500) → jobs re-fetches by itself; phase = 'refreshing'
```

This is the one genuinely new capability over `FetchStore` and it composes with everything
else (a reactive query over a search-input observable *is* the type-ahead case `remoteData`
was built for). Keep it opt-in: implicit refetching must never be the default in a package
whose ethos is explicitness. Caveat to document: the tracked reads are the producer's
synchronous prefix (same rule as any MobX reaction).

## 2. `mutation` — imperative operations with visible state

The write-side half of `remoteData`'s `PublicState` (`isPending`, `buttonProps`), without
the debounce entanglement:

```ts
interface Mutation<Args extends unknown[], R> {
    (...args: Args): Promise<R>;
    readonly isPending: boolean;
    readonly error: SourceError | null;
}

const rename = mutation(
    async (spaceId: UuidString, title: string) => {
        const res = await apiClient.spaces[':spaceId'].$patch({ param: { spaceId }, json: { title } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
    },
    { refreshes: () => [spacesQuery] },     // settle → refresh (not load: stale data stays up)
);
```

- `refreshes` declares the read-side dependents — replacing the `await this.load()` calls
  sprinkled through `SpacesListStore` — and runs **refresh**, so lists don't blank.
- `buttonProps`-style helpers (`disabled` while pending) can ship as a tiny adapter rather
  than living on the primitive; the delayed-indication half is again the UI's business.

## 3. Optimistic changes — three options

The Jnana pattern (`SpacesListStore.rename`): patch the local array in place, fire the
request, on failure re-fetch and rethrow. The old `ActiveData` pattern: a `draft` overlay
deep-merged over `originalData` via property magic.

- **Option A — patch + recover on the owning primitive (recommended).** Optimism is a
  property of a *mutation against a collection/query*, expressed as a plain patch:

  ```ts
  const rename = mutation(renameRequest, {
      optimistic: (spaceId: UuidString, title: string) =>
          spaces.patchItem(spaceId, (s) => ({ ...s, title })),   // applied immediately
      onError: 'refresh',                                        // or a rollback fn
  });
  ```

  `onError: 'refresh'` (re-fetch truth) is the honest default for shared data — it is what
  Jnana already does, and it needs no inverse-patch bookkeeping. A `rollback` callback is
  the escape hatch for offline-ish flows. Simple, typeable, and the patch reuses the same
  `patchItem` used for server-push updates.

- **Option B — draft overlay (`ActiveData` modernized).** Keep server truth and local
  edits separate (`value` = merge(original, draft); `commit()`/`revert()`). Assessment:
  the *idea* is right for **forms** (edit screens with cancel), but `ActiveData`'s
  execution — `defineProperty` getters over a deep merge, `__dataType` type gymnastics,
  the documented deep-merge ambiguity — should not be ported. If the form need returns, a
  small explicit `draft(entity)` helper (no property magic, field-level boxes) is the
  shape. **Not in v1.**

- **Option C — leave optimism to app code.** Always possible since data is instance-owned
  (mutate the observable, catch, refresh). Rejected as the *design*: the try/catch/refresh
  choreography is exactly the boilerplate worth owning, and Option A is small.

## 4. `collection` — keyed items, reconciliation, nested reactivity

The generalization of `JnanaList.reconcileItems` — the requirement bundle "keeping state
after refreshes" + "nested reactivity". The problem: a refresh returns fresh JSON; naive
replacement (`this.data = result`) destroys object identity, so row components re-render
wholesale, memoized item wrappers rebuild, selection/DnD/refs churn. `JnanaList` solves it
at the view layer (keyed item cache + `nodesEqual`); the *data* layer should solve it once,
underneath every view:

```ts
interface Collection<T, Item = T> {
    readonly items: readonly Item[];        // stable identities across refreshes
    readonly query: Query<readonly T[]>;    // the underlying fetch (phase/refresh/reset)
    patchItem(key: string, patch: (item: Item) => void | Item): void;  // optimistic edits
    insert(raw: T, at?: number): void;
    remove(key: string): void;
    getByKey(key: string): Item | undefined;
    source(): Source<Collection<T, Item>>;
}

function collection<T>(options: {
    fetch: (signal: AbortSignal) => Promise<readonly T[]>;
    key: (raw: T) => string;
    equals?: (a: T, b: T) => boolean;       // default: comparer.shallow (as JnanaList)
}): Collection<T>;
```

Reconcile-on-refresh, mirroring `reconcileItems`: match new rows to existing items by
`key`; unchanged (per `equals`) rows **keep their item instance untouched**; changed rows
update the existing instance's observable fields **in place** (not replaced), so only
observers of that item re-render — that is the nested reactivity. Order comes from the
fresh result. The array reference swaps only when membership/order/identity changed (the
same "don't churn on no-op recompute" rule `reconcileItems` applies).

**Item shape options:**

- v1: items are observable copies of the raw rows (fields made observable, updated in
  place). Covers `SpacesListStore`, admin lists.
- Optional `into`: wrap rows in app classes with behavior, preserving instances across
  refreshes — `into: (raw, prev) => prev ? prev.update(raw) : new SpaceRow(raw)`. This is
  the hook that lets per-item UI state (expanded, editing) live on the item and survive a
  refresh.

**Relation to `JnanaList`:** the list keeps its own `JnanaListItem` cache (it reconciles
*visible tree rows*, a view concern — expansion, level, posinset), but its accessors read a
`collection`'s stable items, so the two-layer identity churn (data identity + row identity)
collapses to one. `isValueEqual` defaults stop mattering when the values themselves are
stable.

## 5. Pagination — build on `collection`, smallest honest API

Two shapes exist; don't build both up front:

- **Load-more / infinite** (recommended first — it matches the visible Jnana need: admin
  jobs' growing `limit` is a poor man's load-more). `pagedCollection({ fetchPage(cursor,
  signal), key })` keeps one reconciled `items` array, appends pages, exposes
  `loadMore()` / `hasMore` / `phase`. Refresh re-fetches from the first page and
  reconciles — scroll position and item identities survive because reconciliation, not
  replacement, is the primitive underneath.
- **Numbered pages** (offset/limit with `total`, `goToPage(n)`) — a thin variant where
  `items` is the current page; add when an actual table UI needs it.

Both are conveniences over `query` + `collection`; if the composition isn't clean, that's
feedback on the primitives, which is why pagination should be designed *after* the two of
them stabilize.

## 6. Scope/island integration — the seam with core

First load through the island; live updates through MobX; refresh through the store:

```ts
// The store graph owns the instance (instance-owned, sharable):
class SpacesManagementStore {
    spaces = collection({ fetch: (signal) => fetchSpaces(signal), key: (s) => s.spaceId });
    rename = mutation(renameRequest, {
        optimistic: (id: UuidString, title: string) =>
            this.spaces.patchItem(id, (s) => ({ ...s, title })),
        onError: 'refresh',
    });
}

// The route scope awaits first readiness; the resolved prop is the collection itself:
export const spacesScope = scope()
    .load({ stores: hook(() => useStores()) })
    .load({ spaces: ({ stores }) => stores.spacesManagement.spaces.source() });

// The component observes fine-grained state; refreshes never re-trip the island:
const SpacesPage = observer(({ spaces }: ScopeProps<typeof spacesScope>) => (
    <List items={spaces.items} dimmed={spaces.query.phase === 'refreshing'} />
));
```

Division of labor: the island covers `loading`/`error` for the **first** resolution (with
`loadingDelayMs` for flicker); the collection's `refreshing` phase drives the **stale**
presentation (directly as above, or via the island's `keepStale` once a scope-level
`refresh()` exists — [improvements.md §1–2](./improvements.md)). `not-available` vs
`failed` distinctions ride on `SourceError.code` end to end.

This composition — island resolves once, store refreshes forever — is the design's load-
bearing test: if replacing `FetchStore` in `SpacesPage`, `SpaceMembersPage`, and the admin
pages doesn't get *shorter*, the primitives are wrong.

## 7. Disposition of the legacy layer

| Legacy piece | Fate |
| --- | --- |
| `remoteData` debounce (coalesced promises) | `query`/`mutation` `debounce` option |
| `remoteData` race guard | invariant inside `query` |
| `remoteData` `indicatePendingAfterTimeoutMs` / `PublicState.buttonProps` | mandala `loadingDelayMs` / tiny UI adapter |
| `ActiveData` / `ActiveApiData` draft overlay | not ported; revisit as explicit `draft()` if a form need returns |
| `apiUtils` (`remoteDataKey`, `responseKey`) | not ported (app-level response plucking) |
| `observableSource` | stays as the bridge (in `rati/mobx`, or re-exported by the package) |
| Jnana `FetchStore` | replaced by `query` (+ `collection` where the data is a list) |

Once the package exists, `rati/mobx`'s `data/` re-exports are deleted; the entry keeps only
`observableSource` (or is itself absorbed by the package — one fewer entry point, decide at
extraction time).

## Open questions

- Package location: separate repo vs a workspace here (`packages/rati-data`). A workspace
  keeps the `rati-dev` source-consumption trick working for Jnana.
- Does `source()` yield the instance (as sketched — components observe it) or the raw
  value `T` (island re-resolves per refresh)? The instance is the recommendation; yielding
  `T` would drag every refresh through the island and fight the stale-display story.
- `reactive: true` scheduling: reaction-per-query vs one shared scheduler; interaction
  with `debounce`.
- Should `collection` support server-pushed single-item updates (`upsert(raw)`) in v1?
  Cheap to add, and Jnana's sync layer will want it.
- Error retention on refresh failure: keep stale `data` + set `error` (recommended — the
  mandala/staleness story needs both), or clear data (FetchStore keeps it today too).
