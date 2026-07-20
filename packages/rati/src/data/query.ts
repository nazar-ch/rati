import { observable, Reaction, runInAction } from 'mobx';
import { observableSource } from '../mobx/observableSource';
import { toSourceError, type Source, type SourceError } from '../scope/source';

/*
    `query` — the refreshable unit (the rati/data atom): one async producer, one
    current value, honest phases, race-guarded. Design record:
    docs/archive/directions-2026-07/data-package.md §1.

      - `load()` is idempotent *ensure*: it fetches from `idle` or `error`, no-ops
        when `ready`, and returns the in-flight promise while pending. Scopes (via
        `source()`) and effects call it.
      - `refresh()` is the only re-fetch; the data stays visible (phase
        `refreshing`), and a refresh failure keeps the stale value alongside the
        error. Mutations and user gestures call it.
      - The race guard is an invariant, not an option: a superseded request's
        settle is ignored and its `AbortSignal` fires, so producers can cancel.
      - `set()`/`patch()` are the single-value write seam (`upsert`/`patchItem`'s
        siblings): local truth now, server truth on the next refresh. They swap
        the `data` reference (the notification) and touch no fetch and no error.
      - `load()`/`refresh()` resolve when the fetch settles either way — failure is
        state (`phase`/`error`), not a rejection.
      - `reactive: true` re-fetches when the producer's *synchronous prefix* reads
        change (opt-in — implicit refetching is never the default). A MobX
        `Reaction` tracks those reads during the real fetch and re-runs `refresh()`
        on change, coalesced by `debounce` if set. Design pass:
        data-package.md §DATA-01.
*/

export type QueryPhase = 'idle' | 'loading' | 'ready' | 'refreshing' | 'error';

export interface QueryOptions {
    /**
     * Coalesce `refresh()` bursts (the type-ahead case): the fetch fires `waitMs`
     * after the last call, but no later than `maxWaitMs` after the first of the
     * burst. All coalesced calls share one promise. `load()` never debounces —
     * an ensure wants data now (it does join an already-scheduled fetch).
     */
    debounce?: { waitMs: number; maxWaitMs?: number };
    /**
     * Opt-in: re-fetch when the observables the producer reads *synchronously*
     * (before its first `await`) change — the type-ahead / filter case, the fix
     * for a store's manual `load()`-after-every-setter. The re-run is a
     * `refresh()`, so it flows through `debounce` if set. Reads made after the
     * first `await` are **not** tracked (MobX's async boundary) — destructure
     * every reactive dependency at the top of the producer. Never the default;
     * implicit refetching is opt-in in a package whose ethos is explicitness.
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
    load(): Promise<void>;
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
     * value — `data` is a ref, so the reference swap *is* the notification.
     * No-ops before the first value. No dirty-mark is needed: a refresh
     * overwrites wholesale, so `onError: 'refresh'` recovery works by
     * construction.
     */
    patch(producer: (current: T) => T): void;
    /** Back to idle; drops data and error, aborts anything in flight. */
    reset(): void;
    /**
     * Bridge to a scope's `.load()`: pending until the first ready, then ready
     * forever with **this instance** as the value — later refreshes and refresh
     * errors are the instance's own observable state and never re-trip the
     * island. `attach()` triggers `load()` (ensure); detach does nothing — the
     * store owns the data's lifetime, not the island.
     */
    source(): Source<Query<T>>;
}

/** Package-internal hooks — the seam `collection` builds on. Not public API. */
export interface QueryInternalOptions<T> extends QueryOptions {
    /**
     * Runs inside the settling action of a *current* (non-superseded) fetch, and
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
    let scheduled: {
        timer: ReturnType<typeof setTimeout>;
        firstCallAt: number;
        promise: Promise<void>;
        resolve: () => void;
    } | null = null;
    let reaction: Reaction | null = null;
    let memoizedSource: Source<Query<T>> | undefined;

    // Track the producer's synchronous reads during the *real* fetch (zero extra
    // producer executions): a tracked observable changing re-runs the query. The
    // reaction re-tracks on every fetch, so conditional reads stay accurate.
    // Called inside the fetch IIFE's try, so a synchronous throw (either path)
    // lands on the normal error path — but a throw inside `track` must be
    // re-raised *outside* it, or the reaction's own error boundary swallows it.
    function callProducer(signal: AbortSignal): Promise<T> {
        if (!options.reactive) return producer(signal);
        reaction ??= new Reaction('rati.query.reactive', () => {
            if (options.onReactiveInvalidate) options.onReactiveInvalidate();
            else reactiveRefresh();
        });
        let result!: Promise<T>;
        let caught: { value: unknown } | undefined;
        reaction.track(() => {
            try {
                result = producer(signal);
            } catch (thrown) {
                caught = { value: thrown };
            }
        });
        if (caught) throw caught.value;
        return result;
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
        // Cleanup outside the async body: it must run *after* the `inFlight`
        // assignment even when the producer throws synchronously (the async
        // body settles before the assignment in that case).
        void promise.finally(() => {
            if (inFlight === promise) inFlight = null;
            if (controller === ownController) controller = null;
        });
        return promise;
    }

    function scheduleDebounced(waitMs: number, maxWaitMs: number | undefined): Promise<void> {
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
        scheduled = { timer: setTimeout(fire, waitMs), firstCallAt: Date.now(), promise, resolve };
        runInAction(() => {
            state.pending = true; // a fetch is imminent — honest, not presentational
        });
        return promise;
    }

    function fire(): void {
        const current = scheduled;
        if (!current) return;
        scheduled = null;
        void startFetch().then(current.resolve);
    }

    function load(): Promise<void> {
        if (scheduled) return scheduled.promise;
        if (inFlight) return inFlight;
        if (state.hasData && !state.error) return Promise.resolve(); // ready → no-op
        return startFetch();
    }

    function refresh(): Promise<void> {
        if (inFlight) return inFlight;
        const { debounce } = options;
        if (debounce) return scheduleDebounced(debounce.waitMs, debounce.maxWaitMs);
        return startFetch();
    }

    // The default reactive invalidation. Unlike `refresh()` it does *not* dedupe
    // against the in-flight fetch — a tracked input changed, so that fetch is now
    // stale and must be superseded (startFetch aborts + bumps the race guard),
    // not joined. Debounce still coalesces the burst; an in-flight stale fetch may
    // settle and show briefly before the debounced re-fetch supersedes it.
    function reactiveRefresh(): void {
        const { debounce } = options;
        if (debounce) void scheduleDebounced(debounce.waitMs, debounce.maxWaitMs);
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
        if (scheduled) {
            clearTimeout(scheduled.timer);
            scheduled.resolve(); // a cancelled coalesced refresh resolves, not hangs
            scheduled = null;
        }
        // Stop reacting: the next explicit load()/refresh() re-establishes tracking.
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
        load,
        refresh,
        set,
        patch,
        reset,
        source() {
            memoizedSource ??= instanceSource(
                self,
                () => ({ hasData: state.hasData, error: state.error }),
                () => void load(),
            );
            return memoizedSource;
        },
    };
    return self;
}

/**
 * Package-internal: the shared `source()` shape — pending until the instance's
 * first ready, then ready forever with the same reference (data-package.md
 * ground rules). An error *before* the first ready surfaces to the island's
 * error slot; its `retry` remounts → `attach()` → `load()` re-fetches from
 * `error`.
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
