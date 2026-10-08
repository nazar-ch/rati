import { autorun, runInAction } from 'mobx';

import { itemMap, type ItemMapOptions } from './itemMap.js';

/*
    long:2
    `reconciled` — the identity-stable list view over ANY observable rows: a `collection`'s
    reconciler half on its own, for the list half of a composite response a `query` holds.

        overview = query((signal) => fetchOverview(this.spaceId, signal));
        spaces = reconciled(() => this.overview.data?.spaces ?? [], { key: (s) => s.id });

    It owns identity and the optimistic-patch/server-truth contract; the backing query owns
    fetch, phase and error. The derivation is EAGER — an `autorun` from construction, since a
    reconcile on the first `items` read writes observable state inside a reader's `computed`:

      - the getter runs ONCE IMMEDIATELY, so in a class the backing query is declared ABOVE
        the view, or construction throws;
      - the view holds a subscription for its lifetime, which `dispose()` releases.
*/

/** Options for {@link reconciled} — the reconciler's half of `CollectionOptions`. */
export type ReconciledOptions<T, Item = T> = ItemMapOptions<T, Item>;

export interface Reconciled<T, Item = T> {
    /** The rows as items — stable identities across the getter's changes. */
    readonly items: readonly Item[];
    getByKey(key: string): Item | undefined;
    /**
     * Optimistic edit: mutate the item in place (return nothing) or return a
     * replacement. Either way the entry is marked so the next reconcile
     * restores server truth.
     */
    patchItem(key: string, patch: (item: Item) => Item | void): void;
    /** Server-pushed single-item update — the reconciler applied to one row. */
    upsert(raw: T): void;
    /** Local insert (defaults to the end); an existing key upserts in place. */
    insert(raw: T, at?: number): void;
    remove(key: string): void;
    /**
     * Stop tracking the rows getter. The items stay readable at their last
     * value; a disposed view is not re-established.
     */
    dispose(): void;
}

export function reconciled<T, Item = T>(
    rows: () => readonly T[],
    options: ReconciledOptions<T, Item>,
): Reconciled<T, Item> {
    const map = itemMap<T, Item>(options);

    const stop = autorun(
        () => {
            const next = rows();
            runInAction(() => map.reconcile(next));
        },
        { name: 'rati.reconciled' },
    );

    return {
        get items() {
            return map.items;
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
        dispose() {
            stop();
        },
    };
}
