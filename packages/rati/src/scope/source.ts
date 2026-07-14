import { is } from '../util/utils';

/*
    Sources — the reactive data primitive an island observes. A source is a live `pending | ready | error`
    state machine; the island aggregates a set of them into one of those phases and
    renders the matching slot. Source-agnostic: CRDT resources, REST loaders, plain
    promises all implement the same interface, so the island never knows what's
    behind a prop.
*/

/**
 * Thrown by a load function (or used as a promise rejection) to signal that the
 * requested data does not exist. {@link toSourceError} maps it to the unified
 * `error` state with `code: 'not-available'`.
 */
export class NotAvailableError extends Error {
    code: string | undefined;

    constructor(message = 'Not available', options?: { code?: string; cause?: unknown }) {
        super(message, { cause: options?.cause });
        this.name = 'NotAvailableError';
        this.code = options?.code;
    }
}

/**
 * The one error shape. not-available / forbidden / failed / … all collapse here
 * because the island's behavior is identical; `code` stays machine-readable so the
 * error slot (and, later, routing/SSR) can still tell them apart.
 */
export interface SourceError {
    code: string;
    message?: string;
    cause?: unknown;
    retryable?: boolean;
}

export type SourceState<T> =
    | { status: 'pending' }
    | { status: 'ready'; value: T }
    | { status: 'error'; error: SourceError };

export const SourceSymbol = Symbol('rati.source');

/**
 * Declares a source SSR-capable. Under a Suspense-awaiting server render the resolver
 * attaches the marked source *during render*, wraps its first settle into a promise
 * (React's own wait mechanics — `use()`/Suspense), and dehydrates the ready value. The
 * marker is a promise of conduct: `attach()` is server-safe and the state machine
 * settles in a reasonable timeframe — the same trust extended to any promise load (a
 * hung one hangs the prerender; budgets belong to the prerender helper).
 *
 * Two shapes, one rule — loaders say `true`, live sources provide `hydrate`:
 *
 *   - `ssr: true` — "a loader in source clothing". Promise semantics end to end: the
 *     ready value (which must be JSON-serializable) is dehydrated; on the client the
 *     key short-circuits to that value and the source is never created nor attached —
 *     exactly how promise loads hydrate today.
 *   - `ssr: { hydrate, dehydrate? }` — a live source that can be seeded. The server
 *     dehydrates `dehydrate(value)` (defaults to the value itself); the client calls
 *     `hydrate(data)` on the freshly created source *before* attaching, so its first
 *     snapshot is already ready — no gap, no double fetch, fully live afterward.
 *
 * A live source that cannot seed simply stays unmarked: pending HTML, client
 * resolution — the previous behavior.
 */
export type SourceSSR<T> =
    | true
    | {
          /** Serialize the ready value for the wire. Defaults to the value itself. */
          dehydrate?: (value: T) => unknown;
          /** Seed the underlying store from the wire value, before `attach()`. */
          hydrate: (data: unknown) => void;
      };

/**
 * A reactive 3-state data source, shaped for React's `useSyncExternalStore`: the
 * island subscribes with `subscribe(onChange)` and reads the current state with
 * `getSnapshot()`, so a transition re-renders. `getSnapshot()` must return a
 * referentially stable value while the state is unchanged — uSES compares snapshots
 * by identity, so a fresh object every call would loop. Lifetime is explicit:
 * `attach()` starts/holds the underlying work and returns a detach function the
 * island calls on teardown (unmount / param change).
 *
 * Reactivity-agnostic: a plain promise, a CRDT handle, or a MobX derivation can all
 * back one — see `rati/mobx`'s `observableSource` to adapt a MobX observable.
 */
export interface Source<T> {
    readonly [SourceSymbol]: true;
    subscribe(onChange: () => void): () => void;
    getSnapshot(): SourceState<T>;
    attach(): () => void;
    /** SSR capability marker — see {@link SourceSSR}. Absent: pending under SSR. */
    readonly ssr?: SourceSSR<T> | undefined;
}

export function isSource(value: unknown): value is Source<unknown> {
    return is.object(value) && SourceSymbol in value;
}

const noopDetach = () => {};

/** A source already holding a value (a plain prop, a resolved class instance). */
export function readySource<T>(value: T): Source<T> {
    const state: SourceState<T> = { status: 'ready', value };
    return {
        [SourceSymbol]: true,
        subscribe: () => noopDetach,
        getSnapshot: () => state,
        attach: () => noopDetach,
    };
}

/**
 * Adapts an in-flight promise to a source: pending → ready / error.
 *
 * Not SSR-capable by default (the value may be non-serializable); a promise of
 * JSON-safe data can opt in with `{ ssr: true }` — it is a loader by construction.
 */
export function promiseSource<T>(promise: Promise<T>, options?: { ssr?: SourceSSR<T> }): Source<T> {
    // Hand-rolled subscribable: a listener set + a single stored state object whose
    // identity changes only on transition, so `getSnapshot` stays uSES-stable.
    let state: SourceState<T> = { status: 'pending' };
    const listeners = new Set<() => void>();
    const set = (next: SourceState<T>) => {
        state = next;
        // Set iteration tolerates a listener unsubscribing mid-notify (a deleted,
        // not-yet-visited entry is simply skipped), so iterate directly.
        for (const listener of listeners) listener();
    };
    void promise.then(
        (value) => set({ status: 'ready', value }),
        (reason: unknown) => set({ status: 'error', error: toSourceError(reason) }),
    );
    return {
        [SourceSymbol]: true,
        subscribe(onChange) {
            listeners.add(onChange);
            return () => {
                listeners.delete(onChange);
            };
        },
        getSnapshot: () => state,
        attach: () => noopDetach,
        ...(options?.ssr !== undefined && { ssr: options.ssr }),
    };
}

/** Lifts a value / promise / source into a source (idempotent on sources). */
export function toSource<T>(value: T | Promise<T> | Source<T>): Source<T> {
    if (isSource(value)) return value as Source<T>;
    if (is.promise(value)) return promiseSource(value as Promise<T>);
    return readySource(value as T);
}

/**
 * Maps a thrown/rejected reason that may already *be* a SourceError (a plain object
 * with a string `code`) to the unified shape; anything else goes through
 * {@link toSourceError}. The boundary and the SSR error collector share it.
 */
export function asSourceError(thrown: unknown): SourceError {
    if (
        is.object(thrown) &&
        !(thrown instanceof Error) &&
        typeof (thrown as { code?: unknown }).code === 'string'
    ) {
        return thrown as SourceError;
    }
    return toSourceError(thrown);
}

/** Maps an arbitrary thrown/rejected reason to the unified SourceError. */
export function toSourceError(reason: unknown): SourceError {
    if (reason instanceof NotAvailableError) {
        return {
            code: reason.code ?? 'not-available',
            message: reason.message,
            cause: reason.cause,
        };
    }
    if (reason instanceof Error) return { code: 'failed', message: reason.message, cause: reason };
    return { code: 'failed', cause: reason };
}
