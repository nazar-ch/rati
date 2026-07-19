import { itemMap, type ItemMapOptions } from './itemMap';
import { createQuery, instanceSource, type Query, type QueryOptions } from './query';
import { type Source } from '../scope/source';

/*
    `collection` — keyed items, reconciliation, nested reactivity. Design record:
    docs/archive/directions-2026-07/data-package.md §2.

    A refresh returns fresh JSON; naive replacement destroys object identity, so
    rows re-render wholesale and selection/DnD/refs churn. The reconciler (the
    shared `itemMap`) solves it once, underneath every view.

    Optimistic patches and server-push updates go through the same two entry
    points (`patchItem`/`upsert`), so there is one identity story. A patched item
    is marked so the next reconcile reapplies server truth over it even when the
    server row itself didn't change — that is what makes `onError: 'refresh'`
    recovery actually recover.

    `debounce` and `reactive` pass straight through to the underlying `query`, so
    a keystroke-driven filter over a flat list is `collection({ fetch, key,
    reactive: true, debounce: { waitMs } })` — the fetch reads the store's search
    term, a change re-runs it, coalesced.
*/

export interface Collection<T, Item = T> {
    /** Stable identities across refreshes. */
    readonly items: readonly Item[];
    /** The underlying fetch (phase / refresh / reset). */
    readonly query: Query<readonly T[]>;
    /** Delegates to `query.refresh()`, so a collection can sit in a mutation's `refreshes` list. */
    refresh(): Promise<void>;
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
    /** Same contract as `Query.source()`: ready with **this instance** on first fetch. */
    source(): Source<Collection<T, Item>>;
}

export interface CollectionOptions<T, Item> extends ItemMapOptions<T, Item>, QueryOptions {
    fetch: (signal: AbortSignal) => Promise<readonly T[]>;
}

export function collection<T, Item = T>(options: CollectionOptions<T, Item>): Collection<T, Item> {
    const map = itemMap<T, Item>(options);
    let memoizedSource: Source<Collection<T, Item>> | undefined;

    const q = createQuery<readonly T[]>((signal) => options.fetch(signal), {
        onSuccess: (rows) => map.reconcile(rows),
        onReset: () => map.clear(),
        ...(options.debounce !== undefined && { debounce: options.debounce }),
        ...(options.reactive !== undefined && { reactive: options.reactive }),
    });

    const self: Collection<T, Item> = {
        get items() {
            return map.items;
        },
        query: q,
        refresh() {
            return q.refresh();
        },
        getByKey(key) {
            return map.getByKey(key);
        },
        patchItem(key, patch) {
            map.patch(key, patch);
        },
        upsert(raw) {
            map.upsert(raw);
        },
        insert(raw, at) {
            map.insert(raw, at);
        },
        remove(key) {
            map.remove(key);
        },
        source() {
            memoizedSource ??= instanceSource(
                self,
                () => ({ hasData: q.data !== undefined, error: q.error }),
                () => void q.load(),
            );
            return memoizedSource;
        },
    };
    return self;
}
