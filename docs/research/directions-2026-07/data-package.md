# The companion data package — design

The successor of the legacy `data/` layer (`remoteData`, `ActiveData`, `apiUtils`, shipped via
`rati/mobx`) and of Jnana's `FetchStore` family. Second revision: the first pass distilled the two
live generations; this one adds the omni-admin archaeology — the `FormStore`/`FieldStore` forms
layer and the `Chunks.ts` pagination layer — and turns the options into one coherent design.
**Forms are in scope for the first iteration**; the earlier draft deferred them.

## What each generation contributes

- **Legacy rati `data/`** — `remoteData`: debounce with coalesced promises, the race guard, the
  pending-indication delay (a presentation concern, rehomed to the mandala). `ActiveData`: the
  draft-over-baseline *idea* (right, for forms) wrapped in the wrong execution (`defineProperty`
  getters over a deep merge, `__dataType` gymnastics, documented merge ambiguity).
- **omni-admin `forms.ts`** — instance-owned form stores with self-contained field boxes (value +
  validation + binding props) and a typed `values` aggregate. Right skeleton; wrong taxonomy (a
  class per widget kind with a hand-written conditional-type dispatch table), stringly validation,
  no dirty/baseline story.
- **omni-admin `Chunks.ts`** — pagination as an array of independently loadable, independently
  observable chunk objects: per-chunk load state, "has more" represented structurally (an unloaded
  tail chunk), and cursor-anchor + relative-offset addressing for random access over cursor APIs.
  No race guard, no error state, no refresh — the state machinery didn't survive; the topology
  ideas do.
- **Jnana** — `FetchStore`: the lean refreshable unit (race guard, honest reset) that conflates
  first-load and reload in one `isLoading`. `SpacesListStore`: the optimistic
  patch/recover-by-refresh choreography, hand-rolled per method. `JobsListStore`: composition over
  inheritance (six stores) and the reactive-params need (manual `load()` after every setter).
  `JnanaList.reconcileItems`: identity-stable reconciliation — the data layer should own what the
  list solved at the view layer.

## Ground rules

- **A companion package, not core.** Working name **`rati-data`** — still right with forms in
  scope: a form is staged data. Peer-deps: `rati`, `mobx`. MobX is fine here — this package is
  *for* MobX-shaped apps; core stays uSES-only. New code uses plain observable objects from
  factories (no decorators — don't extend the `@babel/plugin-proposal-decorators` debt the legacy
  `data/` layer carries).
- **Instance-owned data.** Each query/collection/form is an object living in the app's store
  graph; sharing happens by sharing the instance. No keyed shared cache, no normalized store —
  deliberately out of scope to keep the design iterable. (The ref-counting layer,
  `ResourceContainer`, may move to rati core separately — see
  [improvements.md §5](./improvements.md).)
- **Phases are data; presentation is the mandala's.** The package reports honest phases
  (`loading` vs `refreshing`, per-page phases, `isSubmitting`). Pending-indication delay
  (`loadingDelayMs`) and stale-content display live in the island
  ([improvements.md §2](./improvements.md)) — the package never owns a timer that exists only to
  decide what a user sees.
- **One error shape.** Everything that fails — query, page, mutation, form submit — normalizes to
  `SourceError` (`toSourceError`), so the same `code` switch works everywhere and the island error
  slot and in-content error states speak one language.
- **Composition, not inheritance.** Factories return plain observable objects; domain stores hold
  them as fields (the `JobsListStore` lesson). No exported base classes; a store that wants to
  *be* a query exposes delegating members.
- **Bridges to core via `Source`.** Read-side primitives expose `source()` (built on
  `observableSource`) so a scope's `.load()` can await first readiness and the island's
  loading/error slots cover the initial load. After that, components observe the instance directly
  — fine-grained MobX reactivity, no island re-resolution. Decisions folded in (previously open):
  `source()` yields **the instance**, not the raw value — pending until the first `ready`, then
  ready forever with that same reference; later refreshes and refresh errors are the instance's
  own observable state and never re-trip the island. `attach()` triggers `load()` (ensure
  semantics); `detach` does nothing — the store owns the data's lifetime, not the island.
- **Plain-English naming** (the core policy applies): `query`, `mutation`, `collection`,
  `pagedCollection`, `form`, `field` — words React developers already know from the ecosystem.
- **Testability by construction.** Every primitive is driven by a producer function, so a deferred
  promise fake can walk any primitive through every phase in tests — no module mocking (pairs with
  the `rati/testing` direction, [improvements.md §7](./improvements.md)).

## The shape: five primitives, one lifecycle

Data in an app has four moments; each primitive owns exactly one, plus one for fetch topology:

| Moment | Primitive | Replaces |
| --- | --- | --- |
| Read one value | `query` | `FetchStore`, `remoteData` reads |
| Read a keyed set | `collection` | `FetchStore<T[]>` + `reconcileItems` + ad-hoc patching |
| Read in pages | `pagedCollection` | `Chunks.ts`, `JobsListStore`'s growing `limit` |
| Stage local edits | `form` + `field` | `FormStore`/`FieldStore`, `ActiveData` drafts |
| Write | `mutation` | `remoteData` writes + hand-rolled optimistic choreography |

Optimism is deliberately **two-sided** and has no primitive of its own: *before* submit it is the
form (staged edits nobody else sees; cancel = discard); *after* submit it is the mutation's
optimistic patch against collections (expected truth every observer sees early). See §6.

## 1. `query` — the refreshable unit

The atom: one async producer, one current value, honest phases, race-guarded.

```ts
type QueryPhase = 'idle' | 'loading' | 'ready' | 'refreshing' | 'error';

interface Query<T> {
    readonly data: T | undefined;      // last good value; survives refresh AND refresh failure
    readonly phase: QueryPhase;
    readonly error: SourceError | null; // may coexist with stale data (failed refresh)
    readonly isPending: boolean;        // loading || refreshing
    load(): Promise<void>;              // ensure: fetches only from idle/error; dedupes in flight
    refresh(): Promise<void>;           // explicit re-fetch; data stays visible; dedupes in flight
    reset(): void;                      // back to idle; drops data and error
    source(): Source<Query<T>>;         // pending until first ready, then this instance
}

function query<T>(producer: (signal: AbortSignal) => Promise<T>, options?: QueryOptions): Query<T>;
```

Decisions:

- **`load()` and `refresh()` are a real pair now** (the first revision blurred them): `load()` is
  idempotent *ensure* — it fetches from `idle` or `error`, no-ops when `ready`, and returns the
  in-flight promise while pending. `refresh()` is the only re-fetch. Scopes and `attach()` call
  `load()`; mutations and user gestures call `refresh()`. This kills the `FetchStore` conflation
  at the API level, not just in the phase enum.
- **Pending phase is derived from data presence**: `data === undefined ? 'loading' : 'refreshing'`
  — so a retry after a failed first load shows `loading`, a re-fetch over stale data shows
  `refreshing`, and the mandala's stale-display story gets exactly the signal it needs.
- **Refresh failure keeps stale data** (previously open — decided): `phase: 'error'`, `error` set,
  `data` retained. The staleness presentation needs both; a component shows the stale list plus an
  error badge.
- **Race guard is an invariant, not an option** (the `requestId` pattern all three generations
  carry). The producer receives an `AbortSignal` so superseded requests can actually cancel,
  mirroring the core abort proposal ([improvements.md §1](./improvements.md)).
- **Debounce as an option** — `remoteData`'s coalescing of keystroke-driven calls survives as
  `options.debounce: { waitMs, maxWaitMs }`; its pending-indication half does not (mandala's job).
- **Reactive parameters, opt-in** — `options.reactive: true` tracks the producer's observable
  reads (MobX reaction over its synchronous prefix) and re-runs on change as a `refresh()`,
  debounced. This is the type-ahead case `remoteData` was built for and the fix for
  `JobsListStore`'s manual `load()`-after-every-setter. Implicit refetching must never be the
  default in a package whose ethos is explicitness.

## 2. `collection` — keyed items, reconciliation, nested reactivity

The generalization of `JnanaList.reconcileItems`. A refresh returns fresh JSON; naive replacement
destroys object identity, so rows re-render wholesale and selection/DnD/refs churn. The data layer
solves it once, underneath every view:

```ts
interface Collection<T, Item = T> {
    readonly items: readonly Item[];        // stable identities across refreshes
    readonly query: Query<readonly T[]>;    // the underlying fetch (phase / refresh / reset)
    getByKey(key: string): Item | undefined;
    patchItem(key: string, patch: (item: Item) => Item | void): void;  // optimistic edits
    upsert(raw: T): void;                   // server-pushed single-item update
    insert(raw: T, at?: number): void;
    remove(key: string): void;
    source(): Source<Collection<T, Item>>;
}

function collection<T, Item = T>(options: {
    fetch: (signal: AbortSignal) => Promise<readonly T[]>;
    key: (raw: T) => string;
    equals?: (a: T, b: T) => boolean;       // default: comparer.shallow (as JnanaList)
    into?: (raw: T, prev: Item | undefined) => Item;
}): Collection<T, Item>;
```

Reconcile-on-refresh, mirroring `reconcileItems`: match new rows to existing items by `key`;
unchanged rows (per `equals`) **keep their item instance untouched**; changed rows update the
existing instance's observable fields **in place**, so only observers of that item re-render —
that is the nested reactivity. Order comes from the fresh result. The array reference swaps only
when membership/order/identity actually moved (the "don't churn on no-op recompute" rule).

- **`upsert` is in v1** (previously open — decided): it is the reconciler applied to one row, it
  is cheap, and Jnana's sync layer will push single-item updates. Optimistic patches and
  server-push updates go through the same two entry points (`patchItem`/`upsert`), so there is one
  identity story.
- **`into`** wraps rows in app classes with behavior, preserving instances across refreshes
  (`into: (raw, prev) => prev ? prev.update(raw) : new SpaceRow(raw)`) — validated twice over by
  `Chunks.ts`'s `itemTransform` and `JnanaList`'s item cache. Per-item UI state (expanded,
  editing) lives on the item and survives refresh.
- **Relation to `JnanaList`**: the list keeps its own `JnanaListItem` cache (visible tree rows are
  a view concern — expansion, level, posinset), but its accessors read a collection's stable
  items, so the two-layer identity churn collapses to one.

## 3. `pagedCollection` — pages are queries

`Chunks.ts`'s lasting idea: the page, not the list, is the unit of load state. Its execution
lacked race guards, error state, and refresh — but all of that is exactly what `query` already
is. So the composition: **a paged collection is a collection whose fetch topology is an array of
queries.** No third state machine; per-page phase, stale-on-refresh, abort, and `SourceError` come
for free:

```ts
interface PagedCollection<T, Item = T> {
    readonly items: readonly Item[];                    // reconciled concat of loaded pages
    readonly pages: ReadonlyArray<Query<readonly T[]>>; // per-page phase / error / refresh
    readonly hasMore: boolean;                          // derived: an unloaded tail page exists
    loadMore(): Promise<void>;                          // tail page .load()
    refresh(): Promise<void>;                           // re-fetch loaded pages, re-anchoring
    reset(): void;
    source(): Source<PagedCollection<T, Item>>;
}

function pagedCollection<T, C = string>(options: {
    fetchPage: (cursor: C | null, signal: AbortSignal)
        => Promise<{ items: readonly T[]; nextCursor: C | null }>;
    key: (raw: T) => string;
    equals?: (a: T, b: T) => boolean;
    into?: (raw: T, prev: Item | undefined) => Item;
}): PagedCollection<T>;
```

- **One identity map under all pages** — pages own fetch topology; the collection reconciler owns
  item identity. A page refresh updates items in place; an item appearing on a different page
  after refresh keeps its instance.
- **Structural has-more** (from `Chunks.ts`): a `nextCursor` in a page result materializes an
  unloaded tail page; `hasMore` derives from its existence. The tail page's `loading` phase *is*
  the load-more spinner row; a failed `loadMore()` is that page's `error` — an inline retry row
  that doesn't poison the rest of the list.
- **Page k anchors on page k−1**: each page's producer reads its predecessor's `nextCursor` at
  fetch time. `refresh()` re-runs loaded pages sequentially, re-anchoring as it goes — depth,
  scroll position, and item identities survive; the reconciler absorbs rows that moved across page
  boundaries. Cursor drift under heavy concurrent mutation is real but bounded (each refreshed
  page yields a fresh anchor for the next); a truncating `restart` variant is the fallback if
  drift proves visible in practice (open question).
- **Numbered pages and sparse random access are extensions, not a second implementation.** The
  page array generalizes to an index-addressed sparse array (placeholder pages for a known
  `total`, skeleton rows, load-on-scroll), and `Chunks.ts`'s cursor-anchor + relative-offset
  technique — fetch `{ after: nearestLoadedAnchor, offset: target − anchorPosition }`, pure-offset
  as the anchor-zero special case — is the recorded addressing scheme for random access over
  cursor APIs. Not v1; the admin tables' visible need is load-more.
- **Reactive filter params invalidate cursors**: a filter change can't re-anchor. A reactive
  paged collection resets to the first page on tracked-param change (open question on the exact
  contract).

## 4. `mutation` — imperative operations with visible state

The write half of `remoteData` without the debounce entanglement, plus the optimistic choreography
`SpacesListStore` hand-rolls per method:

```ts
interface Mutation<Args extends unknown[], R> {
    (...args: Args): Promise<R>;
    readonly isPending: boolean;
    readonly error: SourceError | null;
}

function mutation<Args extends unknown[], R>(
    perform: (...args: Args) => Promise<R>,
    options?: {
        optimistic?: (...args: Args) => void;     // applied synchronously before the request
        refreshes?: () => ReadonlyArray<{ refresh(): Promise<void> }>;
        onError?: 'refresh' | ((...args: Args) => void);   // default 'refresh'
    },
): Mutation<Args, R>;

const rename = mutation(
    async (spaceId: UuidString, title: string) => {
        const res = await apiClient.spaces[':spaceId'].$patch({ param: { spaceId }, json: { title } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
    },
    {
        optimistic: (spaceId, title) => spaces.patchItem(spaceId, (s) => ({ ...s, title })),
        refreshes: () => [spaces],
    },
);
```

- **`refreshes` declares the read-side dependents** — replacing the `await this.load()` calls
  sprinkled through `SpacesListStore` — and runs **refresh**, so lists show stale content instead
  of blanking.
- **`onError: 'refresh'`** (re-fetch truth from the `refreshes` list) is the honest default for
  shared data — it is what Jnana already does and needs no inverse-patch bookkeeping. A callback
  is the escape hatch for offline-ish flows that must roll back locally.
- The error normalizes to `SourceError` and the call still **rethrows**, so callers (a form's
  submit, see §5) can react; `mutation.error` exists for UI that watches the operation itself
  (a toolbar button's error badge). `buttonProps`-style helpers stay a tiny UI adapter, not
  primitive surface; the delayed-indication half is the mandala's.
- Concurrency: calls run independently; `isPending` is true while any is in flight. Coalescing /
  serialization (the legacy debounce-for-writes) waits for a real need (open question).

## 5. `form` and `field` — staged edits

The distillation of omni-admin's `forms.ts` (instance-owned field boxes — right) and `ActiveData`
(baseline + draft — right idea, wrong machinery). One generic field, no widget-class taxonomy, no
deep merge, no property magic: **the form is the draft** — fields enumerate the edited set
explicitly, the baseline lives per field, dirty is a comparison, not an overlay.

```ts
type Validator<T> = (value: T) => string | undefined;
// shipped validator kit: required(msg?), minLength(n), maxLength(n), min(n), max(n), pattern(re, msg?)

interface Field<T> {
    value: T;                            // observable, widget-facing
    setValue(value: T): void;            // action; re-validates if currently invalid
    readonly errors: readonly string[];
    readonly isInvalid: boolean;
    readonly isDirty: boolean;           // vs baseline (default Object.is; equals option)
    validate(): boolean;
    reset(): void;                       // back to baseline
    readonly props: {                    // React Aria Components-shaped
        value: T;
        onChange: (value: T) => void;
        isInvalid: boolean;
        errorMessage: string | undefined;
    };
}

function field<T>(initial: T, options?: {
    validate?: Validator<T> | readonly Validator<T>[];
    equals?: (a: T, b: T) => boolean;
}): Field<T>;

interface Form<F extends Record<string, Field<any>>> {
    readonly fields: F;
    readonly values: { [K in keyof F]: F[K] extends Field<infer T> ? T : never };
    readonly isDirty: boolean;           // any field dirty
    readonly isSubmitting: boolean;
    readonly error: SourceError | null;  // form-level (non-field) submit error
    validate(): boolean;
    reset(): void;                       // all fields to baseline; clears errors
    commit(): void;                      // baseline = current values (after a successful save)
    submit(handler: (values: Values<F>) => Promise<void>): () => Promise<void>;
}

function form<F extends Record<string, Field<any>>>(fields: F): Form<F>;
```

Decisions:

- **One generic `field<T>`, zero widget subclasses.** The legacy class-per-widget taxonomy and its
  hand-maintained conditional-type dispatch existed to fake per-field value types; a single
  generic makes the `values` inference real and free. Widget kind is the component's business.
- **The `value`/`validatedValue` split dissolves into the widget layer.** It was the right 2023
  instinct for raw DOM inputs; with React Aria Components the widgets already speak domain types
  (`NumberField` takes a `number` and owns the text buffer, `DatePicker` takes a date value), so
  the field stores one type and `props` binds directly. A `parse`/`format` option is the recorded
  v2 escape hatch if a raw-input case returns.
- **Explicit validators, no implicit rules.** Required-by-default is gone (it was invisible magic,
  and its truthiness rules conflated "required" with "must accept" for booleans). `validate:
  required()` says what it does; the kit stays tiny and a validator is just a function.
- **One validation-timing policy, no configuration**: validate on submit; a field that currently
  has errors re-validates on every change, so errors disappear the moment the input becomes valid
  (the legacy clear-on-change default, made honest — it re-checks instead of blindly clearing).
  Touched/blur-based flows are out of v1.
- **Baseline semantics distilled from `ActiveData`**: `field(space.title)` — building a form from
  an entity *is* the draft; `isDirty` compares against baseline, `reset()` is cancel, `commit()`
  re-baselines. `submit` commits automatically on success (the baseline tracks saved truth); a
  handler that needs different behavior owns it explicitly.
- **`submit` is the seam with `mutation`**: it validates (aborts if invalid), sets `isSubmitting`,
  runs the handler (which typically awaits one or more mutations), and maps failures: a thrown
  `FormError` (package-provided, carrying `{ fieldErrors?: Record<string, string>; message? }`)
  distributes onto matching fields; anything else lands on `form.error` as a `SourceError`. The
  API layer decides where a 422's payload becomes a `FormError` — the package only defines the
  shape.

**React 19 — one thin bridge, no architectural adoption.** The function `submit()` returns is
action-compatible: usable as `<form action={store.save}>` (RAC's `Form` accepts `action`), which
removes `onSubmit`/`preventDefault` ceremony and makes `useFormStatus().pending` work for generic
submit buttons — it agrees with `isSubmitting` by construction since the action's promise is ours.
The rest of the React 19 form stack is deliberately not used: `useActionState` duplicates state
the store owns; `useOptimistic` puts optimistic state inside React where other observers of a
collection can't see it — it fights instance-owned data; uncontrolled inputs + auto-reset conflict
with store-controlled fields (controlled fields make React's auto-reset a no-op, so the bridge is
safe).

**v1 boundary, drawn on purpose**: flat field records only — no nested/array fields, no schema
DSL (a zod adapter is possible later; a validator is already just a function), no async
validators, no focus management, no wizard state. Forms are cheap to build badly and expensive to
build well; past this line lives TanStack Form with less testing.

## 6. Optimism — two sides of one submit

The first revision weighed three options for "optimistic changes"; the resolution is that optimism
is two different things on either side of a write, and each already has an owner:

- **Before submit — staged edits (the form).** Local, private, cancellable. Nothing else observes
  them; cancel is `reset()`. This is `ActiveData`'s draft idea in its right home (old Option B,
  distilled).
- **After submit — optimistic propagation (the mutation).** `optimistic:` patches the owning
  collection synchronously, so every observer sees expected truth early; `onError: 'refresh'`
  recovers actual truth (old Option A, kept).

They meet at exactly one point: submit = validate → fire mutation (optimistic patch applies) → on
success `commit()` / on failure `FormError` → fields, collections refresh. Each side stays small
because the other exists. (Old Option C — leave it to app code — remains rejected: the
try/catch/refresh choreography is exactly the boilerplate worth owning.)

## 7. Scope/island integration — the seam with core

First load through the island; live updates through MobX; refresh through the store; forms never
touch the island (they are synchronous local state seeded from data the island already resolved):

```ts
// The store graph owns the instances (instance-owned, sharable):
class SpacesManagementStore {
    spaces = collection({ fetch: (signal) => fetchSpaces(signal), key: (s) => s.spaceId });

    rename = mutation(renameRequest, {
        optimistic: (id: UuidString, title: string) =>
            this.spaces.patchItem(id, (s) => ({ ...s, title })),
        refreshes: () => [this.spaces],
    });
}

// A dialog store stages edits against one item:
class RenameDialogStore {
    constructor(private store: SpacesManagementStore, space: SpaceListItem) {
        this.form = form({ title: field(space.title, { validate: required() }) });
        this.save = this.form.submit(async ({ title }) => {
            await this.store.rename(space.spaceId, title);
        });
    }
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
`loadingDelayMs` for flicker); the primitives' phases drive everything after — `refreshing` for
stale display (directly, or via the island's `keepStale` once it exists —
[improvements.md §2](./improvements.md)), per-page phases for pagination rows, `isSubmitting` for
buttons. `not-available` vs `failed` rides on `SourceError.code` end to end. Under SSR the
primitives stay pending (a `Source` attaches in effects), which is correct — this package is for
the interactive app, not the SSR path.

**The load-bearing tests** — if these don't get *shorter*, the primitives are wrong:

- Replacing `FetchStore` in `SpacesPage`, `SpaceMembersPage`, and the admin pages (read side).
- Replacing `JobsListStore`'s six stores + manual `load()` calls with reactive queries.
- Rebuilding omni-admin's `AclUserModalStore` shape — which needed `FormStore` + `remoteData` +
  `ActiveData` simultaneously — with `form` + `mutation` + `collection` (write side).

## 8. Disposition of the legacy layers

| Legacy piece | Fate |
| --- | --- |
| `remoteData` debounce (coalesced promises) | `query` `debounce` option |
| `remoteData` race guard | invariant inside `query` |
| `remoteData` `indicatePendingAfterTimeoutMs` / `buttonProps` | mandala `loadingDelayMs` / tiny UI adapter |
| `ActiveData` / `ActiveApiData` draft overlay | distilled into `form` baseline (`isDirty`/`reset`/`commit`); merge/property magic not ported |
| `apiUtils` (`remoteDataKey`, `responseKey`) | not ported (app-level response plucking) |
| omni `forms.ts` field boxes + typed `values` | `field`/`form`, one generic, inference made real |
| omni `forms.ts` widget-class taxonomy, stringly validation | not ported (validator kit; RAC-shaped `props`) |
| omni `forms.ts` `value`/`validatedValue` split | dissolved into RAC widgets; `parse` recorded as v2 escape hatch |
| omni `Chunks.ts` chunk model, per-chunk load state | `pagedCollection` pages-as-queries |
| omni `Chunks.ts` structural has-more | `hasMore` derived from the unloaded tail page |
| omni `Chunks.ts` cursor-anchor + offset addressing | recorded for the numbered/sparse extension (not v1) |
| `observableSource` | stays as the bridge (in `rati/mobx`, or re-exported by the package) |
| Jnana `FetchStore` | replaced by `query` (+ `collection` where the data is a list) |
| Jnana `JnanaList.reconcileItems` | stays view-level; reads a `collection`'s stable items underneath |

Once the package exists, `rati/mobx`'s `data/` re-exports are deleted; the entry keeps only
`observableSource` (or is itself absorbed by the package — one fewer entry point, decide at
extraction time).

## Open questions

- Package location: separate repo vs a workspace here (`packages/rati-data`). A workspace keeps
  the `rati-dev` source-consumption trick working for Jnana.
- Entry layout: one entry, or a `rati-data/form` subpath so data-only consumers don't see forms.
- `reactive: true` scheduling: reaction-per-query vs a shared scheduler; interaction with
  `debounce`.
- `pagedCollection.refresh()` drift: is sequential re-anchoring enough in practice, or does a
  truncating `restart` variant need to exist from day one? And the exact contract when reactive
  filter params change (cursors invalid → reset to first page).
- `upsert` racing an in-flight refresh: ordering guarantee (apply-after-settle vs
  last-write-wins on the reconciler).
- Mutation coalescing/serialization option (the legacy write-debounce) — wait for a real need.
- `FormError` field keys: `Record<string, string>` vs typed `keyof Values` (typed is nicer,
  but the error is usually constructed far from the form's type).
- Async validators (server-side uniqueness checks) — out of v1; the seam would be a validator
  returning a promise plus a per-field pending flag. Wait for need.
