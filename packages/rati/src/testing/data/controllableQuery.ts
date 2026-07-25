import { query, type Query, type QueryOptions } from '../../data/query';
import { controllableProducer, type ControllableProducer } from './controllableProducer';

/*
    `controllableQuery` — `controllableSource`'s data analogue: a **real** `query`
    whose producer the test settles by hand, with the query's own surface and the
    producer's ledger on one object.

    It is not a wrapper. The control members are defined *onto* the query instance
    (descriptors, so the live getters stay live), which keeps the identity contract
    intact: `q.source()` resolves with `q` itself, `===` the object the test holds —
    exactly what an island receives. A delegating façade would resolve with the inner
    instance instead and quietly break every `value: q` assertion.
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
