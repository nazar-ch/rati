import { observable, Reaction, runInAction } from 'mobx';

import { observableSource } from '../mobx/observableSource.js';
import { toSourceError, type Source, type SourceError } from '../scope/source.js';

/*
    `query` — the refreshable unit: one async producer, one current value, honest phases. The
    race guard is an invariant: a superseded request's settle is ignored and its `AbortSignal`
    fires. `prime()`/`refresh()` resolve either way — failure is state, never a rejection.
*/

export type QueryPhase = 'idle' | 'loading' | 'ready' | 'refreshing' | 'error';

export interface QueryOptions {
    /**
     * Coalesce `refresh()` bursts (the type-ahead case): the fetch fires `waitMs`
     * after the last call, but no later than `maxWaitMs` after the first of the
     * burst. All coalesced calls share one promise. `prime()` never debounces —
     * an ensure wants data now (it does join an already-scheduled fetch).
     */
    debounce?: { waitMs: number; maxWaitMs?: number };
    /**
     * Opt-in: re-fetch, through `debounce`, when the observables the producer reads
     * SYNCHRONOUSLY — before its first `await` — change. A read after the first `await` is
     * NOT tracked, so destructure every reactive dependency at the producer's top.
     */
    reactive?: boolean;
}

export interface Query<T> {
    /** Last good value; survives refresh AND refresh failure. */
    readonly data: T | undefined;
    readonly phase: QueryPhase;
    /** May coexist with stale `data` (a failed refresh). */
    readonly error: SourceError | null;
    /** loading || refreshing */
    readonly isPending: boolean;
    /** Ensure: fetches only from idle/error; dedupes in flight. */
    prime(): Promise<void>;
    /** Explicit re-fetch; `data` stays visible; dedupes in flight. */
    refresh(): Promise<void>;
    /**
     * Replace the value locally (the server-push seam — `upsert`'s single-value
     * sibling). Doesn't touch `error` or any fetch; last-write-wins against an
     * in-flight refresh.
     */
    set(next: T): void;
    /**
     * Optimistic edit (`patchItem`'s single-value sibling): must return the next
     * value — `data` is a ref, so the reference swap IS the notification.
     * No-ops before the first value. No dirty-mark is needed: a refresh
     * overwrites wholesale, so `onError: 'refresh'` recovery works by
     * construction.
     */
    patch(producer: (current: T) => T): void;
    /** Back to idle; drops data and error, aborts anything in flight. */
    reset(): void;
    /**
     * Bridges to a scope's `.load()`: pending until the first ready, then ready forever with
     * THIS instance, so later refreshes and errors never re-trip the island. `attach()`
     * primes; the store, not the island, owns the data's lifetime. Typed {@link ReadyQuery}.
     */
    source(): Source<ReadyQuery<T>>;
}

/**
 * A {@link Query} seen after its first ready: `data` is `T`. The `source()` goes ready only
 * once `hasData` is set, and `reset()` clears it, re-tripping the island, so the claim never
 * goes stale under a live component. A read-side claim only: every method works through it.
 */
export type ReadyQuery<T> = Query<T> & { readonly data: T };

/** Package-internal hooks — the seam `collection` builds on. Not public API. */
export interface QueryInternalOptions<T> extends QueryOptions {
    /**
     * Runs inside the settling action of a current (non-superseded) fetch, and
     * inside `set`/`patch`'s action — every way a value lands. `collection`
     * reconciles here, so a local write keeps the item map coherent.
     */
    onSuccess?: (value: T) => void;
    /** Runs inside `reset()`'s action, after the query's own state cleared. */
    onReset?: () => void;
    /**
     * Replaces the default reactive invalidation (`refresh()`) — `pagedCollection`
     * passes a reset-to-first-page here, since a tracked-param change invalidates
     * every cursor. Only consulted when `reactive` is set.
     */
    onReactiveInvalidate?: () => void;
}

export function query<T>(
    producer: (signal: AbortSignal) => Promise<T>,
    options?: QueryOptions,
): Query<T> {
    return createQuery(producer, options);
}

/** Package-internal factory taking the extra hooks (see {@link QueryInternalOptions}). */
export function createQuery<T>(
    producer: (signal: AbortSignal) => Promise<T>,
    options: QueryInternalOptions<T> = {},
): Query<T> {
    const state = observable(
        {
            data: undefined as T | undefined,
            // `data === undefined` can't distinguish "no value yet" from a
            // producer that legitimately resolved `undefined`; the flag is the
            // honest form of the design's "pending phase derives from data
            // presence".
            hasData: false,
            error: null as SourceError | null,
            pending: false,
        },
        { data: observable.ref, error: observable.ref },
        { deep: false },
    );

    let requestId = 0;
    let controller: AbortController | null = null;
    let inFlight: Promise<void> | null = null;
    const debouncer = createDebouncer(startFetch, () =>
        runInAction(() => {
            state.pending = true; // a fetch is imminent — honest, not presentational
        }),
    );
    let reaction: Reaction | null = null;
    let memoizedSource: Source<ReadyQuery<T>> | undefined;

    // Tracks the producer's synchronous reads during the REAL fetch, with no extra execution,
    // re-tracking per fetch. Called inside the fetch's try, so a synchronous throw lands on
    // the error path.
    function callProducer(signal: AbortSignal): Promise<T> {
        if (!options.reactive) return producer(signal);
        reaction ??= new Reaction('rati.query.reactive', () => {
            if (options.onReactiveInvalidate) options.onReactiveInvalidate();
            else reactiveRefresh();
        });
        return trackRethrowing(reaction, () => producer(signal));
    }

    function startFetch(): Promise<void> {
        const id = ++requestId;
        controller?.abort();
        const ownController = new AbortController();
        controller = ownController;
        runInAction(() => {
            state.pending = true;
        });
        const promise = (async () => {
            try {
                // Runs synchronously up to the producer's first await (so the
                // reactive track captures its prefix before this IIFE suspends).
                const value = await callProducer(ownController.signal);
                if (id !== requestId) return; // superseded — the guard invariant
                runInAction(() => {
                    state.data = value;
                    state.hasData = true;
                    state.error = null;
                    state.pending = false;
                    options.onSuccess?.(value);
                });
            } catch (thrown) {
                if (id !== requestId) return;
                runInAction(() => {
                    // Keep stale `data`: a component shows it plus an error badge.
                    state.error = toSourceError(thrown);
                    state.pending = false;
                });
            }
        })();
        inFlight = promise;
        // Cleanup outside the async body: it must run AFTER the `inFlight`
        // assignment even when the producer throws synchronously (the async
        // body settles before the assignment in that case).
        void promise.finally(() => {
            if (inFlight === promise) inFlight = null;
            if (controller === ownController) controller = null;
        });
        return promise;
    }

    function prime(): Promise<void> {
        const joined = debouncer.pending ?? inFlight;
        if (joined) return joined;
        if (state.hasData && !state.error) return Promise.resolve(); // ready → no-op
        return startFetch();
    }

    function refresh(): Promise<void> {
        if (inFlight) return inFlight;
        const { debounce } = options;
        if (debounce) return debouncer.schedule(debounce.waitMs, debounce.maxWaitMs);
        return startFetch();
    }

    // The default reactive invalidation. Unlike `refresh()` it supersedes the in-flight
    // fetch, now stale, rather than joining it; the debounce still coalesces the burst.
    function reactiveRefresh(): void {
        const { debounce } = options;
        if (debounce) void debouncer.schedule(debounce.waitMs, debounce.maxWaitMs);
        else void startFetch();
    }

    function set(next: T): void {
        runInAction(() => {
            state.data = next;
            state.hasData = true;
            options.onSuccess?.(next);
        });
    }

    function patch(producer: (current: T) => T): void {
        if (!state.hasData) return; // nothing to patch yet
        runInAction(() => {
            const next = producer(state.data as T);
            state.data = next;
            options.onSuccess?.(next);
        });
    }

    function reset(): void {
        requestId += 1; // anything in flight settles into the void
        controller?.abort();
        controller = null;
        inFlight = null;
        debouncer.cancel();
        // Stop reacting: the next explicit prime()/refresh() re-establishes tracking.
        reaction?.dispose();
        reaction = null;
        runInAction(() => {
            state.data = undefined;
            state.hasData = false;
            state.error = null;
            state.pending = false;
            options.onReset?.();
        });
    }

    const self: Query<T> = {
        get data() {
            return state.data;
        },
        get phase(): QueryPhase {
            if (state.pending) return state.hasData ? 'refreshing' : 'loading';
            if (state.error) return 'error';
            return state.hasData ? 'ready' : 'idle';
        },
        get error() {
            return state.error;
        },
        get isPending() {
            return state.pending;
        },
        prime,
        refresh,
        set,
        patch,
        reset,
        source() {
            // The cast is safe: `instanceSource` publishes the instance only once `hasData`,
            // the claim `ReadyQuery` makes.
            memoizedSource ??= instanceSource(
                self as ReadyQuery<T>,
                () => ({ hasData: state.hasData, error: state.error }),
                () => void prime(),
            );
            return memoizedSource;
        },
    };
    return self;
}

interface Debouncer {
    /** The promise every call of the scheduled burst shares; null when no burst is open. */
    readonly pending: Promise<void> | null;
    schedule(waitMs: number, maxWaitMs: number | undefined): Promise<void>;
    /** Drops the scheduled fire and resolves its promise: a cancelled burst resolves, not hangs. */
    cancel(): void;
}

// The `debounce` coalescer: a burst runs `start` once, `waitMs` after its last call and no later
// than `maxWaitMs` after its first. `onScheduled` runs when a burst opens.
function createDebouncer(start: () => Promise<void>, onScheduled: () => void): Debouncer {
    let scheduled: {
        timer: ReturnType<typeof setTimeout>;
        firstCallAt: number;
        promise: Promise<void>;
        resolve: () => void;
    } | null = null;

    function fire(): void {
        const current = scheduled;
        if (!current) return;
        scheduled = null;
        void start().then(current.resolve);
    }

    return {
        get pending() {
            return scheduled?.promise ?? null;
        },
        schedule(waitMs, maxWaitMs) {
            if (scheduled) {
                clearTimeout(scheduled.timer);
                const elapsed = Date.now() - scheduled.firstCallAt;
                const wait =
                    maxWaitMs === undefined
                        ? waitMs
                        : Math.min(waitMs, Math.max(0, maxWaitMs - elapsed));
                scheduled.timer = setTimeout(fire, wait);
                return scheduled.promise;
            }
            let resolve!: () => void;
            const promise = new Promise<void>((res) => {
                resolve = res;
            });
            scheduled = {
                timer: setTimeout(fire, waitMs),
                firstCallAt: Date.now(),
                promise,
                resolve,
            };
            onScheduled();
            return promise;
        },
        cancel() {
            if (!scheduled) return;
            clearTimeout(scheduled.timer);
            scheduled.resolve();
            scheduled = null;
        },
    };
}

// Runs `run` under `reaction`'s tracking. A throw inside `track` is re-raised OUTSIDE it, or
// the reaction's own error boundary swallows it.
function trackRethrowing<R>(reaction: Reaction, run: () => R): R {
    let result!: R;
    let caught: { value: unknown } | undefined;
    reaction.track(() => {
        try {
            result = run();
        } catch (thrown) {
            caught = { value: thrown };
        }
    });
    if (caught) throw caught.value;
    return result;
}

/**
 * Package-internal: the shared `source()` shape — pending until the instance's first ready,
 * then ready forever with the same reference. An error BEFORE the first ready reaches the
 * island's error slot, whose `retry` re-primes from `error`.
 */
export function instanceSource<I>(
    instance: I,
    read: () => { hasData: boolean; error: SourceError | null },
    ensure: () => void,
): Source<I> {
    return observableSource<I>(
        () => {
            const { hasData, error } = read();
            if (hasData) return { status: 'ready', value: instance };
            if (error) return { status: 'error', error };
            return { status: 'pending' };
        },
        () => {
            ensure();
            return () => {};
        },
    );
}
