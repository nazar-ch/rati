import { deferred } from '../deferred.js';

/*
    The `rati/data` half of the hand-drive kit: a producer whose every call the test
    settles, and a `query` pre-wired to one.

    Every data suite written during the jnana migration hand-rolled the same three
    lines — an array of `deferred`s, a call counter, and a closure indexing into them
    (`const gates = [deferred(), deferred()]; let call = 0;
    query(() => gates[call++]!.promise)`) — plus a `let signal` capture whenever the
    abort mattered. That is the shape below, once, with the pieces the hand-rolled
    version kept leaving out: which call is which, whether it settled, and each call's
    own `AbortSignal`.

    Like `controllableSource`'s mutators, the settles here are raw — resolving a call
    notifies through the query's normal MobX path with no `act` wrapping. Awaiting the
    `prime()`/`refresh()` promise is the settle point; in a React test, wrap the drive
    in `act` or follow it with `await flush()`.
*/

/** One invocation of a {@link ControllableProducer}'s producer. */
export interface ProducerCall<T, Args extends unknown[] = []> {
    /** 0-based position in {@link ControllableProducer.calls}. */
    readonly index: number;
    /** The arguments before the trailing signal (`[]` for a plain `query` producer). */
    readonly args: Args;
    /** The `AbortSignal` this call was handed — `signal.aborted` is the supersede assertion. */
    readonly signal: AbortSignal;
    /** The promise this call returned. */
    readonly promise: Promise<T>;
    /** Settled either way yet? */
    readonly settled: boolean;
    /** Sugar for `signal.aborted` — true once a later call (or `reset()`) superseded this one. */
    readonly aborted: boolean;
    /** Settle this call with a value. */
    resolve(value: T): void;
    /** Fail this call. Prefer an `Error` reason (rati maps it to a `SourceError`). */
    reject(reason?: unknown): void;
}

/** A producer under test control, plus the ledger of its calls. */
export interface ControllableProducer<T, Args extends unknown[] = []> {
    /**
     * The producer itself — hand it to `query(…)`, a `collection`'s `fetch`, a
     * `pagedCollection`'s `fetchPage`. The trailing parameter is the `AbortSignal`
     * rati passes, so the bare `controllableProducer<T>()` is exactly
     * `(signal: AbortSignal) => Promise<T>`.
     */
    producer: (...args: [...Args, AbortSignal]) => Promise<T>;
    /** Every call so far, oldest first. Live — it grows as the producer is called. */
    readonly calls: readonly ProducerCall<T, Args>[];
    /** `calls.length`, for the common assertion. */
    readonly callCount: number;
    /** The most recent call. Throws before the first. */
    readonly lastCall: ProducerCall<T, Args>;
    /** The oldest call that hasn't settled — what bare `resolve`/`reject` settle. Throws when there is none. */
    readonly pendingCall: ProducerCall<T, Args>;
    /** Settle the oldest un-settled call (calls settle in order unless you address one). */
    resolve(value: T): void;
    /** Fail the oldest un-settled call. */
    reject(reason?: unknown): void;
}

/** Create a {@link ControllableProducer}. */
export function controllableProducer<T, Args extends unknown[] = []>(): ControllableProducer<
    T,
    Args
> {
    const calls: ProducerCall<T, Args>[] = [];

    const producer = (...received: [...Args, AbortSignal]): Promise<T> => {
        // rati always passes the signal last, whatever precedes it (a page cursor,
        // nothing at all) — so the split is positional, not by arity convention.
        const signal = received[received.length - 1] as AbortSignal;
        const args = received.slice(0, -1) as unknown as Args;
        const gate = deferred<T>();
        let settled = false;
        const call: ProducerCall<T, Args> = {
            index: calls.length,
            args,
            signal,
            promise: gate.promise,
            get settled() {
                return settled;
            },
            get aborted() {
                return signal.aborted;
            },
            resolve(value) {
                settled = true;
                gate.resolve(value);
            },
            reject(reason) {
                settled = true;
                gate.reject(reason);
            },
        };
        calls.push(call);
        return gate.promise;
    };

    const pick = (which: 'lastCall' | 'pendingCall'): ProducerCall<T, Args> => {
        const call =
            which === 'lastCall' ? calls[calls.length - 1] : calls.find((each) => !each.settled);
        if (!call) {
            throw new Error(
                `controllableProducer.${which}: no such call yet (${calls.length} call(s) made). ` +
                    'Did the producer run — a query only fetches from prime()/refresh()?',
            );
        }
        return call;
    };

    return {
        producer,
        calls,
        get callCount() {
            return calls.length;
        },
        get lastCall() {
            return pick('lastCall');
        },
        get pendingCall() {
            return pick('pendingCall');
        },
        resolve: (value) => pick('pendingCall').resolve(value),
        reject: (reason) => pick('pendingCall').reject(reason),
    };
}
