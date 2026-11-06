import { SourceSymbol, type Source, type SourceError, type SourceSSR } from '../scope/source.js';

/*
    A real `Source` a test drives by hand: `island()` attaches, subscribes and re-renders on it
    as on any source. The mutators are RAW — synchronous, no `act` — since engine flow drives a
    source from inside `act` too; wrap a top-level drive in `act`, or `await flush()` after it.
*/

/** Options for {@link controllableSource}. All optional; the bare call starts pending. */
export interface ControllableSourceOptions<T> {
    /** Start `ready` with this value (a stable identity) instead of `pending`. */
    initial?: T;
    /**
     * SSR capability marker for the source's `ssr` field — `true` for a loader,
     * `{ hydrate, dehydrate? }` for a seedable live source. Prefer
     * {@link ControllableSourceOptions.seed} for the seedable shape; a raw object is the
     * escape hatch for `hydrate(data): void` semantics.
     */
    ssr?: SourceSSR<T>;
    /**
     * The loader shape (`ssr: true`): on `attach()`, a still-`pending` source settles `ready`
     * to this value on a microtask; a seeded one is already ready. A FAILING loader drives from
     * `onAttach`: `onAttach: () => queueMicrotask(() => s.setError('not-available'))`.
     */
    loads?: T;
    /**
     * The seedable live-source shape, excluding `ssr`: `dehydrate` serializes the ready value;
     * `hydrate` decodes the wire value and RETURNS the value the source turns `ready` with
     * before `attach()`, a throw modeling a rejected stale seed.
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
    /** Re-emits the last ready value with a STABLE identity — a live source ticking without a
     *  value change, which the island's `===` fast path passes without re-running downstream
     *  loads. Throws before the first {@link setReady}. */
    emit(): void;
    /** Total `attach()` calls over the source's life. */
    readonly attachCount: number;
    /** Total detach calls over the source's life. */
    readonly detachCount: number;
    /** Attached right now (`attachCount − detachCount > 0`) — `false` after teardown is
     *  the no-leak assertion. */
    readonly attached: boolean;
    /** Peak concurrent attaches: above `1` for one instance under one island key is a
     *  double-attach of a live entry; an instance shared across keys or islands attaches once
     *  per key. */
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
        // Set iteration tolerates a listener unsubscribing mid-notify, so iterate directly.
        for (const listener of listeners) listener();
    };
    const set = (next: State<T>) => {
        state = next;
        if (next.status === 'ready') lastReady = { value: next.value };
        notify();
    };

    // The `seed` shape builds the seedable SSR marker: hydrate decodes, and the source is
    // ready before attach.
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
