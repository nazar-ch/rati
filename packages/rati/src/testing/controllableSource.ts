import { SourceSymbol, type Source, type SourceError, type SourceSSR } from '../scope/source';

/*
    A real `Source` a test drives by hand — the ~8th-most-copied helper in rati's suites
    (`testSource` / `makeSource` / `loaderSource`), whose most complete version was locked
    inside the fuzz harness. It is a genuine source: `island()` attaches it, subscribes,
    reads `getSnapshot()`, and re-renders on every transition, exactly as it would a CRDT
    handle or a MobX derivation.

    The mutators are *raw* — they set state and notify listeners synchronously, no `act`
    wrapping. That is deliberate: a source is also driven from inside engine flow (a
    `queueMicrotask` in a load, a fuzz command already inside `act`), where a nested
    auto-`act` would misbehave. Wrap a top-level drive yourself — `act(() => src.setReady(v))`,
    or `src.setReady(v); await flush()` — or let `renderIsland`'s handle do it for you.
*/

/** Options for {@link controllableSource}. All optional; the bare call starts pending. */
export interface ControllableSourceOptions<T> {
    /** Start `ready` with this value (a stable identity) instead of `pending`. */
    initial?: T;
    /**
     * SSR capability marker, passed straight through to the source's `ssr` field —
     * `true` for a loader (a promise in source clothing), or `{ hydrate, dehydrate? }`
     * for a seedable live source. See the `SourceSSR` docs. For the seedable shape, prefer
     * {@link ControllableSourceOptions.seed}, which builds this marker and settles the
     * source for you; a raw `ssr` object is the escape hatch when the test needs the
     * marker's exact `hydrate(data): void` semantics.
     */
    ssr?: SourceSSR<T>;
    /**
     * The loader shape (`ssr: true`): on `attach()`, if still `pending`, settle `ready`
     * to this value on a microtask — a promise-in-source-clothing that resolves itself.
     * Skipped when already seeded (a hydrated source is `ready` at attach), mirroring a
     * real store. For a loader that *fails*, drive it from `onAttach` instead:
     * `onAttach: () => queueMicrotask(() => s.setError('not-available'))`.
     */
    loads?: T;
    /**
     * The seedable-live-source shape, spelled without the self-referential `ssr.hydrate`
     * closure: `dehydrate` serializes the ready value on the server; `hydrate` decodes the
     * wire value and *returns* the seeded value — the source transitions to `ready` with it
     * before `attach()` (throw from it to model a store that rejects a stale seed).
     * Mutually exclusive with `ssr` (it builds that marker for you); combines with `loads`
     * for the real-store shape "load on attach unless already seeded".
     */
    seed?: {
        /** Serialize the ready value for the wire. Defaults to the value itself. */
        dehydrate?: (value: T) => unknown;
        /** Decode the wire value; the return becomes the seeded `ready` value. */
        hydrate: (data: unknown) => T;
    };
    /** Run synchronously at the end of `attach()`, after the ledger updates — for
     *  asserting attach ordering against other lifecycle events. */
    onAttach?: () => void;
    /** Run synchronously at the end of the detach callback, after the ledger updates. */
    onDetach?: () => void;
}

/** A {@link Source} with hand-drive mutators and an attach/detach ledger. */
export interface ControllableSource<T> extends Source<T> {
    /** Transition to `ready` with `value` — a fresh snapshot each call, so uSES re-renders.
     *  Repeatable; pair with {@link setPending} to bounce a live source. */
    setReady(value: T): void;
    /** Transition to `pending`. Repeatable. */
    setPending(): void;
    /** Transition to `error`. A bare string is taken as the `SourceError` `code`. */
    setError(error: SourceError | string): void;
    /** Re-emit the last ready value with a *stable* value identity — a live source ticking
     *  or recovering without a value change (the island's equals-gate compares values, and
     *  the identical identity passes its `===` fast path, so downstream loads do not
     *  re-run). Throws before the first {@link setReady}. */
    emit(): void;
    /** Total `attach()` calls over the source's life. */
    readonly attachCount: number;
    /** Total detach calls over the source's life. */
    readonly detachCount: number;
    /** Attached right now (`attachCount − detachCount > 0`) — `false` after teardown is
     *  the no-leak assertion. */
    readonly attached: boolean;
    /** Peak concurrent attaches. `> 1` for one instance under one island key is a
     *  double-attach of a live entry (a StrictMode remount swaps instances, so that case
     *  never legitimately exceeds 1) — but the same instance shared across keys or islands
     *  legitimately attaches concurrently, one entry per key. */
    readonly peakAttached: number;
}

type State<T> =
    | { status: 'pending' }
    | { status: 'ready'; value: T }
    | { status: 'error'; error: SourceError };

/** Create a {@link ControllableSource}. */
export function controllableSource<T>(
    options: ControllableSourceOptions<T> = {},
): ControllableSource<T> {
    const { ssr, seed, onAttach, onDetach } = options;
    if (ssr !== undefined && seed !== undefined) {
        throw new Error('controllableSource: pass either `ssr` or `seed`, not both');
    }

    // `in` checks, not `!== undefined` sentinels, so `T = undefined` can start ready / load.
    const hasInitial = 'initial' in options;
    const hasLoads = 'loads' in options;

    let state: State<T> = hasInitial
        ? { status: 'ready', value: options.initial as T }
        : { status: 'pending' };
    let lastReady: { value: T } | null = hasInitial ? { value: options.initial as T } : null;
    const listeners = new Set<() => void>();
    let depth = 0;
    let attaches = 0;
    let detaches = 0;
    let peak = 0;

    const notify = () => {
        // Set iteration tolerates a listener unsubscribing mid-notify (as promiseSource
        // relies on too): a deleted, not-yet-visited entry is simply skipped.
        for (const listener of listeners) listener();
    };
    const set = (next: State<T>) => {
        state = next;
        if (next.status === 'ready') lastReady = { value: next.value };
        notify();
    };

    // The `seed` shape builds the seedable SSR marker: hydrate decodes, and the source is
    // ready before attach — exactly what a hand-rolled `ssr: { hydrate: (d) => src.setReady(…) }`
    // closure did, minus the circular-initializer annotation it forced.
    const ssrMarker: SourceSSR<T> | undefined = seed
        ? {
              ...(seed.dehydrate && { dehydrate: seed.dehydrate }),
              hydrate: (data) => set({ status: 'ready', value: seed.hydrate(data) }),
          }
        : ssr;

    return {
        [SourceSymbol]: true,
        ...(ssrMarker !== undefined && { ssr: ssrMarker }),
        getSnapshot: () => state,
        subscribe(onChange) {
            listeners.add(onChange);
            return () => {
                listeners.delete(onChange);
            };
        },
        attach() {
            attaches++;
            depth++;
            if (depth > peak) peak = depth;
            if (hasLoads && state.status === 'pending') {
                queueMicrotask(() => {
                    if (state.status === 'pending') {
                        set({ status: 'ready', value: options.loads as T });
                    }
                });
            }
            onAttach?.();
            return () => {
                detaches++;
                depth--;
                onDetach?.();
            };
        },
        setReady: (value) => set({ status: 'ready', value }),
        setPending: () => set({ status: 'pending' }),
        setError: (error) =>
            set({ status: 'error', error: typeof error === 'string' ? { code: error } : error }),
        emit: () => {
            if (!lastReady) {
                throw new Error('controllableSource.emit(): no ready value to re-emit yet');
            }
            set({ status: 'ready', value: lastReady.value });
        },
        get attachCount() {
            return attaches;
        },
        get detachCount() {
            return detaches;
        },
        get attached() {
            return depth > 0;
        },
        get peakAttached() {
            return peak;
        },
    };
}
