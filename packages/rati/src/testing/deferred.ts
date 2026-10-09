/**
 * A promise plus its `resolve`/`reject`, so a test settles it by hand: handed to a
 * `.load({ … })` or a `query`, it holds a suspended island on its loading slot until `resolve`.
 *
 * ```ts
 * const gate = deferred<number>();
 * const q = query(() => gate.promise);
 * const primed = q.prime(); // → loading
 * gate.resolve(42);
 * await primed;             // → ready, data === 42
 * ```
 */
export interface Deferred<T> {
    readonly promise: Promise<T>;
    /** Settle the promise. `T = void` makes this a no-arg `resolve()`. */
    resolve: (value: T) => void;
    /** Reject the promise. Prefer an `Error` reason (rati maps it to a `SourceError`). */
    reject: (reason?: unknown) => void;
}

/** Create a {@link Deferred}. */
export function deferred<T>(): Deferred<T> {
    let resolve!: (value: T) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}
