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
     * for a seedable live source. See the `SourceSSR` docs. A seedable source's `hydrate`
     * can reference the source itself: the closure runs during hydration, long after
     * construction, so `const s = controllableSource({ ssr: { hydrate: (d) =>
     * s.setReady(decode(d)) } })` is not a real cycle.
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
     *  or recovering without a value change (the island's equals-gate sees the same object,
     *  so downstream loads do not re-run). Throws before the first {@link setReady}. */
    emit(): void;
    /** Total `attach()` calls over the source's life. */
    readonly attachCount: number;
    /** Total detach calls over the source's life. */
    readonly detachCount: number;
    /** Attached right now (`attachCount − detachCount > 0`) — `false` after teardown is
     *  the no-leak assertion. */
    readonly attached: boolean;
    /** Peak concurrent attaches. `> 1` for one instance is a double-attach of a live
     *  entry (a StrictMode remount swaps instances, so it never legitimately exceeds 1). */
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
    const { initial, ssr, loads, onAttach, onDetach } = options;

    let state: State<T> =
        initial === undefined ? { status: 'pending' } : { status: 'ready', value: initial };
    let lastReady: { value: T } | null = initial === undefined ? null : { value: initial };
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

    return {
        [SourceSymbol]: true,
        ...(ssr !== undefined && { ssr }),
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
            if (loads !== undefined && state.status === 'pending') {
                queueMicrotask(() => {
                    if (state.status === 'pending') set({ status: 'ready', value: loads });
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
