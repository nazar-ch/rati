import { autorun, runInAction } from 'mobx';

import { itemMap, type ItemMapOptions } from './itemMap';

/*
    `reconciled` — the identity-stable list view, standalone. Design record:
    docs/archive/directions-2026-07/data-package.md §2.

    `collection` is secretly a `query` plus the shared reconciler; this is that
    second half on its own, over *any* observable rows. It exists because a
    composite response — `{ usefulData, spaces }` — is a `query`, and its list
    half used to get no reconciliation at all:

        overview = query((signal) => fetchOverview(this.spaceId, signal));
        spaces = reconciled(() => this.overview.data?.spaces ?? [], { key: (s) => s.id });

    No fetch, no phase, no error, no `source()` — the backing query owns all of
    those. This owns identity: the same row across two fetches is the same item
    instance, with the same optimistic-patch/server-truth contract collections
    have (a patched entry is marked, so the next reconcile reapplies server
    truth over it).

    **The derivation is eager**, not lazy: an `autorun` established at
    construction re-reconciles whenever the getter's output changes — exactly
    when `collection` used to reconcile inside its query's settling action, and
    identical in cost (one reconcile per rows change, observers or not). The
    lazy alternative — reconciling on the first `items` read — would write
    observable state from inside whatever derivation happens to read it, which
    MobX forbids in a `computed`. Two consequences to know:

      - the getter runs **once immediately**, so in a class the backing query
        must be declared *above* the view (a field initializer reading a
        not-yet-assigned field throws, loudly, at construction);
      - the view holds a subscription for its lifetime — `dispose()` releases
        it when the owner outlives its store (most stores never need to).

    The reconcile itself runs in an action, and MobX actions are untracked, so
    the item map's own reads never become dependencies of the derivation and
    its writes can't re-trigger it.
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
