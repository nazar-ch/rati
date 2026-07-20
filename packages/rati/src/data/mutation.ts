import { observable, runInAction } from 'mobx';
import { toSourceError, type SourceError } from '../scope/source';

/*
    `mutation` — an imperative operation with visible state. Design record:
    docs/archive/directions-2026-07/data-package.md §4.

    The optimistic choreography apps hand-roll per method, owned once:
    `optimistic` patches the read side synchronously before the request (expected
    truth every observer sees early); `refreshes` declares the read-side
    dependents and re-fetches them — **refresh**, so lists show stale content
    instead of blanking — after success, and, under the default
    `onError: 'refresh'`, after failure too (actual truth recovered, no
    inverse-patch bookkeeping). Refreshes are fired, not awaited: their progress
    is the dependents' own `refreshing` phase, not this call's.

    A failure normalizes to `SourceError` on `mutation.error` (for UI watching
    the operation — a toolbar button's badge) and still **rethrows**, so callers
    (a form's submit) can react.
*/

export interface Mutation<Args extends unknown[], R> {
    (...args: Args): Promise<R>;
    /** True while any call is in flight (calls run independently). */
    readonly isPending: boolean;
    /** The last call's failure; cleared when a new call starts. */
    readonly error: SourceError | null;
}

export interface MutationOptions<Args extends unknown[]> {
    /** Applied synchronously (in an action) before the request. */
    optimistic?: (...args: Args) => void;
    /**
     * Read-side dependents to re-fetch — typically collections/queries. Receives
     * the call's arguments, so a keyed dependent can be declared:
     * `refreshes: (spaceId) => [this.membersFor(spaceId)]`.
     */
    refreshes?: (...args: Args) => ReadonlyArray<{ refresh(): Promise<void> }>;
    /**
     * `'refresh'` (default): re-fetch truth from the `refreshes` list. A callback
     * is the escape hatch for offline-ish flows that must roll back locally —
     * it replaces the refresh, it doesn't precede it.
     */
    onError?: 'refresh' | ((...args: Args) => void);
}

export function mutation<Args extends unknown[], R>(
    perform: (...args: Args) => Promise<R>,
    options: MutationOptions<Args> = {},
): Mutation<Args, R> {
    const state = observable(
        { pendingCount: 0, error: null as SourceError | null },
        { error: observable.ref },
        { deep: false },
    );

    const refreshAll = (...args: Args): void => {
        const dependents = options.refreshes?.(...args) ?? [];
        for (const dependent of dependents) void dependent.refresh();
    };

    const call = async (...args: Args): Promise<R> => {
        runInAction(() => {
            state.pendingCount += 1;
            state.error = null;
            options.optimistic?.(...args);
        });
        try {
            const result = await perform(...args);
            runInAction(() => {
                state.pendingCount -= 1;
            });
            refreshAll(...args);
            return result;
        } catch (thrown) {
            runInAction(() => {
                state.pendingCount -= 1;
                state.error = toSourceError(thrown);
            });
            const onError = options.onError ?? 'refresh';
            if (onError === 'refresh') refreshAll(...args);
            else runInAction(() => onError(...args));
            throw thrown;
        }
    };

    Object.defineProperties(call, {
        isPending: { get: () => state.pendingCount > 0, enumerable: true },
        error: { get: () => state.error, enumerable: true },
    });
    return call as Mutation<Args, R>;
}
