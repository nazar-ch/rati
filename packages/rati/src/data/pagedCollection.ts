import { observable, runInAction } from 'mobx';

import { itemMap, type ItemMapOptions } from './itemMap.js';
import { createQuery, instanceSource, type Query } from './query.js';

import { type Source } from '../scope/source.js';

/*
    long:2
    `pagedCollection` — pages are queries: a page IS a `query`, so per-page phase,
    stale-on-refresh, abort and `SourceError` come with it. One identity map sits under all
    pages, so an item moving across a page boundary keeps its instance.

    "Has more" is structural: a `nextCursor` materializes an unloaded tail page, whose `loading`
    phase is the load-more row and whose `error` is an inline retry row.

    Page k anchors on page k−1's `nextCursor` AT FETCH TIME, so `refresh()`, a sequential walk,
    re-anchors as it goes; a refreshed page whose `nextCursor` turns null truncates its
    successors. Cursor drift under heavy concurrent mutation is bounded, not eliminated.

    `reactive: true` RESETS rather than refreshes: a filter-param change invalidates every
    cursor, so the list reloads from a fresh first page and an island drops to loading
    (rati◊DATA-01). The paged reset takes no debounce.
*/

export interface PageResult<T, C> {
    items: readonly T[];
    nextCursor: C | null;
}

export interface PagedCollection<T, C = string, Item = T> {
    /** Reconciled concat of the loaded pages — stable identities. */
    readonly items: readonly Item[];
    /** Per-page phase / error / refresh; `data` is the page's raw result. */
    readonly pages: ReadonlyArray<Query<PageResult<T, C>>>;
    /** Derived: an unloaded tail page exists. */
    readonly hasMore: boolean;
    /** Fetch the tail page (also the initial load, and the retry of a failed one). */
    loadMore(): Promise<void>;
    /** Re-fetch the loaded pages sequentially, re-anchoring cursor by cursor. */
    refresh(): Promise<void>;
    reset(): void;
    /** Same contract as `Query.source()`: ready with THIS instance on the first page. */
    source(): Source<PagedCollection<T, C, Item>>;
}

export interface PagedCollectionOptions<T, C, Item> extends ItemMapOptions<T, Item> {
    fetchPage: (cursor: C | null, signal: AbortSignal) => Promise<PageResult<T, C>>;
    /**
     * Opt-in: reset to the first page when the observables `fetchPage` reads at
     * `cursor === null` change; no cursor survives a param change. `QueryOptions.reactive`
     * holds the tracked-read boundary.
     */
    reactive?: boolean;
}

interface PageRecord<T, C> {
    query: Query<PageResult<T, C>>;
    /** Committed rows of the last successful fetch (null while unloaded). */
    rows: readonly T[] | null;
    /** Known after the first success; re-read by the successor at its fetch time. */
    nextCursor: C | null;
}

export function pagedCollection<T, C = string, Item = T>(
    options: PagedCollectionOptions<T, C, Item>,
): PagedCollection<T, C, Item> {
    const map = itemMap<T, Item>(options);
    const state = observable(
        { records: [] as ReadonlyArray<PageRecord<T, C>> },
        { records: observable.ref },
        { deep: false },
    );
    let memoizedSource: Source<PagedCollection<T, C, Item>> | undefined;

    function makePage(index: number): PageRecord<T, C> {
        const record: PageRecord<T, C> = {
            rows: null,
            nextCursor: null,
            // Placeholder until createQuery below — records are built in one go.
            query: undefined as unknown as Query<PageResult<T, C>>,
        };
        record.query = createQuery<PageResult<T, C>>(
            (signal) => {
                // Anchor at fetch time: a refresh walk hands each page its
                // predecessor's FRESH cursor.
                const cursor = index === 0 ? null : state.records[index - 1]!.nextCursor;
                return options.fetchPage(cursor, signal);
            },
            {
                onSuccess: (result) => commitPage(record, result),
                // Only page 0 tracks the filter params (it fetches at cursor null);
                // deeper pages anchor on cursors and are dropped by the reset anyway.
                ...(index === 0 && options.reactive
                    ? { reactive: true, onReactiveInvalidate: reactivelyReset }
                    : {}),
            },
        );
        return record;
    }

    // A tracked filter param changed; every cursor is now invalid. Drop the whole
    // list and reload from the first page (the source goes pending → the island
    // shows its loading slot). `reset()` disposes the old page 0's reaction and
    // makes a fresh page 0; `loadMore()` fetches it, re-tracking the params.
    function reactivelyReset(): void {
        self.reset();
        void self.loadMore();
    }

    /** Inside the page query's settling action, race-guarded by it. */
    function commitPage(record: PageRecord<T, C>, result: PageResult<T, C>): void {
        const index = state.records.indexOf(record);
        if (index === -1) return; // truncated away while in flight
        record.rows = result.items;
        record.nextCursor = result.nextCursor;
        if (result.nextCursor === null) {
            // The list ends here now; any deeper pages are stale.
            if (state.records.length > index + 1) truncate(index + 1);
        } else if (index === state.records.length - 1) {
            state.records = [...state.records, makePage(index + 1)]; // materialize the tail
        }
        rebuildItems();
    }

    function truncate(from: number): void {
        const dropped = state.records.slice(from);
        state.records = state.records.slice(0, from);
        for (const record of dropped) record.query.reset(); // aborts anything in flight
    }

    function rebuildItems(): void {
        map.reconcile(state.records.flatMap((record) => record.rows ?? []));
    }

    function firstPage(): PageRecord<T, C> {
        let first = state.records[0];
        if (!first) {
            first = makePage(0);
            runInAction(() => {
                state.records = [first!];
            });
        }
        return first;
    }
    firstPage(); // the initial unloaded tail — hasMore is structural from the start

    const self: PagedCollection<T, C, Item> = {
        get items() {
            return map.items;
        },
        get pages() {
            return state.records.map((record) => record.query);
        },
        get hasMore() {
            const tail = state.records[state.records.length - 1];
            return tail !== undefined && tail.query.data === undefined;
        },
        loadMore() {
            const tail = state.records[state.records.length - 1];
            if (!tail || tail.query.data !== undefined) return Promise.resolve(); // fully loaded
            return tail.query.prime(); // idle → fetch; error → retry; in flight → join
        },
        async refresh() {
            for (let index = 0; index < state.records.length; index++) {
                const record = state.records[index]!;
                if (record.query.data === undefined) break; // the unloaded tail
                await record.query.refresh();
                if (state.records[index] !== record) break; // truncated under us
                if (record.query.phase === 'error') break; // don't walk past a failed anchor
            }
        },
        reset() {
            runInAction(() => {
                for (const record of state.records) record.query.reset();
                state.records = [];
                map.clear();
                firstPage();
            });
        },
        source() {
            memoizedSource ??= instanceSource(
                self,
                () => {
                    const first = state.records[0];
                    return {
                        hasData: first !== undefined && first.query.data !== undefined,
                        error: first?.query.error ?? null,
                    };
                },
                () => void firstPage().query.prime(),
            );
            return memoizedSource;
        },
    };
    return self;
}
