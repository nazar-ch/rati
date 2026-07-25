/*
    rati/data — MobX-shaped data primitives: the successor of the legacy
    `remoteData`/`ActiveData` layer and of app-side `FetchStore` families.
    Experimental; pending extraction to a companion package. Design record:
    docs/archive/directions-2026-07/data-package.md.

    Data in an app has four moments; each primitive owns exactly one, plus one
    for fetch topology and one for row identity:

      - `query` — read one value (refreshable, race-guarded, honest phases)
      - `collection` — read a keyed set (identity-stable reconciliation)
      - `reconciled` — that identity story over rows you already have (the
        list half of a composite response), with no fetch of its own
      - `pagedCollection` — read in pages (pages are queries; structural has-more)
      - `form` + `field` — stage local edits (baseline / dirty / validate)
      - `mutation` — write (optimistic patch + refresh choreography)

    `keyed` is not a fifth moment — it is the lazy per-key instance map the
    store graph uses to hold one of the above *per id* (get-or-create, stable
    identity), so a `mutation` can refresh exactly the instance it invalidated.

    Instance-owned data: each primitive is an object living in the app's store
    graph; sharing happens by sharing the instance. Read-side primitives bridge
    to scope loads via `source()` — pending until first ready, then ready forever
    with the instance itself; after that, components observe the instance
    directly (fine-grained MobX reactivity, no island re-resolution).

    Requires the `mobx` optional peer dependency, like `rati/mobx` (which
    provides the underlying `observableSource` bridge).
*/

export { query, type Query, type QueryOptions, type QueryPhase } from './query';
export { collection, type Collection, type CollectionOptions } from './collection';
export { reconciled, type Reconciled, type ReconciledOptions } from './reconciled';
export {
    pagedCollection,
    type PagedCollection,
    type PagedCollectionOptions,
    type PageResult,
} from './pagedCollection';
export { mutation, type Mutation, type MutationOptions } from './mutation';
export { keyed, type Keyed, type KeyedKey } from './keyed';
export { field, type Field, type FieldOptions, type FieldProps, type Validator } from './field';
export { form, FormError, type Form, type FormValues } from './form';
export { max, maxLength, min, minLength, pattern, required } from './validators';
