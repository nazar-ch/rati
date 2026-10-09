import { is } from '../util/utils.js';

/*
    Sources: the live `pending | ready | error` state machine an island observes, aggregating
    a set into one phase and rendering the matching slot. A CRDT resource, a REST loader and a
    plain promise share the interface, so the island never knows what backs a prop.
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
 * The blessed `code` vocabulary an error slot switches on, an OPEN set: `(string & {})`
 * keeps completion for these while a load coins its own. `not-available`, `forbidden` and
 * `invalid` are terminal, `unreachable` is transient, and `failed` is the fallback for
 * anything unclassified.
 */
export type SourceErrorCode =
    | 'not-available'
    | 'forbidden'
    | 'invalid'
    | 'unreachable'
    | 'failed'
    | (string & {});

/**
 * The one error shape: every failure collapses here, and `code` stays machine-readable
 * for the error slot.
 *
 *   - `retryable` is the transient/terminal axis, the only thing the automatic retry
 *     policy consults.
 *   - `code` is the flavor — {@link SourceErrorCode}.
 */
export interface SourceError {
    code: SourceErrorCode;
    message?: string;
    cause?: unknown;
    /**
     * Is another attempt worth making? `true` = transient (a blip, a 5xx, a dropped
     * connection), `false` = terminal — an answer, not a fault. ABSENT = unclassified:
     * the app never said, so the retry policy falls back to the code (see `retry`).
     */
    retryable?: boolean;
}

export type SourceState<T> =
    | { status: 'pending' }
    | { status: 'ready'; value: T }
    | { status: 'error'; error: SourceError };

export const SourceSymbol = Symbol('rati.source');

/**
 * long:2
 * Declares a source SSR-capable: the server render attaches it during render, awaits its
 * first settle and dehydrates the ready value. The marker promises that `attach()` is
 * server-safe and settles; a hung source hangs the prerender.
 *
 *   - `ssr: true` — a loader: the JSON-serializable ready value dehydrates, and the client
 *     takes it without creating or attaching the source.
 *   - `ssr: { hydrate, dehydrate? }` — a live source: the client calls `hydrate(data)` on
 *     the fresh source BEFORE attaching, so its first snapshot is ready.
 *
 * Unmarked, a source stays pending under SSR and resolves on the client.
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
 * A reactive pending/ready/error source shaped for `useSyncExternalStore`: `getSnapshot()`
 * must return a referentially stable value while the state is unchanged. `attach()` starts
 * the work and returns the detach the island calls on teardown. `rati/mobx` adapts a MobX
 * observable.
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
        // Set iteration tolerates a listener unsubscribing mid-notify, so iterate directly.
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
 * Maps a thrown/rejected reason that may already BE a SourceError (a plain object
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

/**
 * Maps a thrown or rejected reason to the unified SourceError. Any `Error` carrying a
 * string `code`, and optionally a boolean `retryable`, maps through with both intact — an
 * app's transport edge speaks to rati this way. Anything else is unclassified:
 * `code: 'failed'` with `retryable` absent.
 */
export function toSourceError(reason: unknown): SourceError {
    if (reason instanceof Error) {
        const carried = reason as Error & { code?: unknown; retryable?: unknown };
        const code = typeof carried.code === 'string' ? carried.code : undefined;
        const retryable = typeof carried.retryable === 'boolean' ? carried.retryable : undefined;
        // `retryable` is optional under exactOptionalPropertyTypes — an unclassified
        // failure must have no key at all, not an `undefined` one.
        const classification = retryable === undefined ? {} : { retryable };
        if (reason instanceof NotAvailableError) {
            return {
                code: code ?? 'not-available',
                message: reason.message,
                cause: reason.cause,
                ...classification,
            };
        }
        // `cause` is the error itself here (not `error.cause`): a plain throw carries no
        // deeper reason, and the error is what a slot wants to inspect.
        return {
            code: code ?? 'failed',
            message: reason.message,
            cause: reason,
            ...classification,
        };
    }
    return { code: 'failed', cause: reason };
}
