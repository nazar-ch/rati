import { type ItemMapOptions } from './itemMap.js';
import { createQuery, instanceSource, type QueryOptions, type QueryPhase } from './query.js';
import { reconciled } from './reconciled.js';

import { type Source, type SourceError } from '../scope/source.js';

/*
    long:2
    `collection` — keyed items, reconciliation, nested reactivity: the shared `itemMap` keeps
    object identity across a refresh's fresh JSON. Optimistic patches and server pushes share
    `patchItem`/`upsert`, and a patched item is marked so the next reconcile reapplies server
    truth — what makes `onError: 'refresh'` recover.

    Structurally the sugar case: a `query` whose response IS the array plus a `reconciled` view,
    behind one flat surface — no `.query`, no raw array. A composite payload takes the two
    directly. `debounce` and `reactive` pass through to the `query`.
*/

export interface Collection<T, Item = T> {
    /** Stable identities across refreshes. */
    readonly items: readonly Item[];
    /** The fetch's phase: `idle → loading → ready / refreshing / error`. */
    readonly phase: QueryPhase;
    /** May coexist with stale `items` (a failed refresh). */
    readonly error: SourceError | null;
    /** loading || refreshing */
    readonly isPending: boolean;
    /** Ensure: fetches only from idle/error; dedupes in flight. */
    prime(): Promise<void>;
    /** Explicit re-fetch; `items` stay visible. Also what a mutation's `refreshes` list calls. */
    refresh(): Promise<void>;
    /** Back to idle; drops the items and the error, aborts anything in flight. */
    reset(): void;
    getByKey(key: string): Item | undefined;
    /**
     * Optimistic edit: mutate the item in place (return nothing) or return a
     * replacement. Either way the entry is marked so the next refresh restores
     * server truth.
     */
    patchItem(key: string, patch: (item: Item) => Item | void): void;
    /** Server-pushed single-item update — the reconciler applied to one row. */
    upsert(raw: T): void;
    /** Local insert (defaults to the end); an existing key upserts in place. */
    insert(raw: T, at?: number): void;
    remove(key: string): void;
    /** Same contract as `Query.source()`: ready with THIS instance on first fetch. */
    source(): Source<Collection<T, Item>>;
}

export interface CollectionOptions<T, Item> extends ItemMapOptions<T, Item>, QueryOptions {
    fetch: (signal: AbortSignal) => Promise<readonly T[]>;
}

export function collection<T, Item = T>(options: CollectionOptions<T, Item>): Collection<T, Item> {
    let memoizedSource: Source<Collection<T, Item>> | undefined;

    const rowsQuery = createQuery<readonly T[]>((signal) => options.fetch(signal), {
        ...(options.debounce !== undefined && { debounce: options.debounce }),
        ...(options.reactive !== undefined && { reactive: options.reactive }),
    });
    // Every way a value lands — a settle, `reset()` back to nothing — is a swap
    // of the query's `data` ref, which is what the view tracks. No hook wiring.
    const view = reconciled<T, Item>(() => rowsQuery.data ?? [], options);

    const self: Collection<T, Item> = {
        get items() {
            return view.items;
        },
        get phase() {
            return rowsQuery.phase;
        },
        get error() {
            return rowsQuery.error;
        },
        get isPending() {
            return rowsQuery.isPending;
        },
        prime() {
            return rowsQuery.prime();
        },
        refresh() {
            return rowsQuery.refresh();
        },
        reset() {
            rowsQuery.reset();
        },
        getByKey(key) {
            return view.getByKey(key);
        },
        patchItem(key, patch) {
            view.patchItem(key, patch);
        },
        upsert(raw) {
            view.upsert(raw);
        },
        insert(raw, at) {
            view.insert(raw, at);
        },
        remove(key) {
            view.remove(key);
        },
        source() {
            memoizedSource ??= instanceSource(
                self,
                () => ({ hasData: rowsQuery.data !== undefined, error: rowsQuery.error }),
                () => void rowsQuery.prime(),
            );
            return memoizedSource;
        },
    };
    return self;
}
