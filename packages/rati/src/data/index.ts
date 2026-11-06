/*
    rati/data — experimental MobX-shaped data primitives, each owning one moment of an app's
    data; the read-side ones bridge to scope loads through `source()`. Their design is
    docs/current/internals.md.
*/

export { query, type Query, type QueryOptions, type QueryPhase, type ReadyQuery } from './query.js';
export { collection, type Collection, type CollectionOptions } from './collection.js';
export { reconciled, type Reconciled, type ReconciledOptions } from './reconciled.js';
export {
    pagedCollection,
    type PagedCollection,
    type PagedCollectionOptions,
    type PageResult,
} from './pagedCollection.js';
export { mutation, type Mutation, type MutationOptions } from './mutation.js';
export { keyed, type Keyed, type KeyedKey } from './keyed.js';
export { field, type Field, type FieldOptions, type FieldProps, type Validator } from './field.js';
export { form, FormError, type Form, type FormValues } from './form.js';
export { max, maxLength, min, minLength, pattern, required } from './validators.js';
