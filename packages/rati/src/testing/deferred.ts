/**
 * A promise plus its `resolve`/`reject`, so a test can settle it by hand — the
 * "testability by construction" ground rule, and the single most-copied test helper
 * across both repos.
 *
 * Drive a load with it to observe every phase without module mocking: hand the promise
 * to a `.load({ … })` (or a `query`) and a suspended island sits on its loading slot until
 * you `resolve` — the moment the content appears is then yours to assert.
 *
 * ```ts
 * const gate = deferred<number>();
 * const q = query(() => gate.promise);
 * q.load();                 // → loading
 * gate.resolve(42);
 * await q.ensureLoaded();   // → ready, data === 42
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
