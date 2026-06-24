import { observable, runInAction } from 'mobx';
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
 * A reactive 3-state data source. `state` must be a MobX-observable derivation —
 * the island reads it inside an `observer`, so transitions re-render. Lifetime is
 * explicit: `attach()` starts/holds the underlying work and returns a detach
 * function the island calls on teardown (unmount / param change).
 */
export interface Source<T> {
    readonly [SourceSymbol]: true;
    readonly state: SourceState<T>;
    attach(): () => void;
}

export function isSource(value: unknown): value is Source<unknown> {
    return is.object(value) && SourceSymbol in value;
}

const noopDetach = () => {};

/** A source already holding a value (a plain prop, a resolved class instance). */
export function readySource<T>(value: T): Source<T> {
    return { [SourceSymbol]: true, state: { status: 'ready', value }, attach: () => noopDetach };
}

/** Adapts an in-flight promise to a source: pending → ready / error. */
export function promiseSource<T>(promise: Promise<T>): Source<T> {
    const state = observable.box<SourceState<T>>({ status: 'pending' }, { deep: false });
    void promise.then(
        (value) => runInAction(() => state.set({ status: 'ready', value })),
        (reason: unknown) =>
            runInAction(() => state.set({ status: 'error', error: toSourceError(reason) })),
    );
    return {
        [SourceSymbol]: true,
        get state() {
            return state.get();
        },
        attach: () => noopDetach,
    };
}

/** Lifts a value / promise / source into a source (idempotent on sources). */
export function toSource<T>(value: T | Promise<T> | Source<T>): Source<T> {
    if (isSource(value)) return value as Source<T>;
    if (is.promise(value)) return promiseSource(value as Promise<T>);
    return readySource(value as T);
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
