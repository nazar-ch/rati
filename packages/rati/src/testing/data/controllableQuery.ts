import { controllableProducer, type ControllableProducer } from './controllableProducer.js';

import { query, type Query, type QueryOptions } from '../../data/query.js';

/*
    `controllableQuery` — a REAL `query` whose producer the test settles by hand, its control
    members defined ONTO the instance, so `q.source()` resolves with `q` itself, as an island
    receives it. A delegating façade resolves with the inner instance instead.
*/

/** A real {@link Query} with its producer's settle controls and call ledger on it. */
export interface ControllableQuery<T> extends Query<T>, ControllableProducer<T> {}

/**
 * Create a {@link ControllableQuery}. `options` are the query's own
 * (`debounce`, `reactive`) and pass straight through.
 *
 * ```ts
 * const q = controllableQuery<number>();
 * const loading = q.prime();
 * expect(q.phase).toBe('loading');
 * q.resolve(42);
 * await loading;
 * expect(q.data).toBe(42);
 * ```
 */
export function controllableQuery<T>(options?: QueryOptions): ControllableQuery<T> {
    const control = controllableProducer<T>();
    const instance = query<T>(control.producer, options);
    // Descriptors, not `Object.assign`: `callCount`/`lastCall`/`pendingCall` are
    // getters, and assigning would freeze one reading of each onto the instance.
    Object.defineProperties(instance, Object.getOwnPropertyDescriptors(control));
    return instance as ControllableQuery<T>;
}
