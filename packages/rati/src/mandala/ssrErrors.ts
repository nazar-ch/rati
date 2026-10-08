import { asSourceError, type SourceError } from '../scope/source.js';

/*
    `ssrErrors: 'dehydrate'` — the server's half: the Step waits on a rejection-proof twin,
    keyed by promise, so a failed load becomes the island's error slot in the HTML. The design
    is docs/current/internals.md.
*/

/** A load's rejection, in the shape a resolved promise can carry. */
export class SsrRejection {
    constructor(readonly error: SourceError) {}
}

/**
 * One run's guard (created with its bucket cache, dies with it — the same lifetime as the
 * rejection ledger it sits beside). Returns the same rejection-proof twin for the same
 * promise every time it is asked.
 */
export function createRejectionGuard(): (promise: Promise<unknown>) => Promise<unknown> {
    const twins = new WeakMap<Promise<unknown>, Promise<unknown>>();
    return (promise) => {
        let twin = twins.get(promise);
        if (!twin) {
            twin = promise.then(
                undefined,
                (reason: unknown) => new SsrRejection(asSourceError(reason)),
            );
            twins.set(promise, twin);
        }
        return twin;
    };
}
