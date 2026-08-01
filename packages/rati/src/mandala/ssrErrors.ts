import { asSourceError, type SourceError } from '../scope/source';

/*
    `ssrErrors: 'dehydrate'` — the server's half.

    React runs no error boundary during a server render. A rejected load therefore reaches
    nobody: `use()` throws, React abandons the Suspense boundary, emits the *loading* slot
    with its client-retry marker, and the client re-runs the load. That is the default and
    it is self-healing — but it is not deterministic, and an island that wants its error
    slot in the HTML has to be met where the throw happens instead: in the resolver.

    So the Step waits on a promise that *cannot* reject. The guard hands back a twin whose
    rejection settles into a marker value, which the resolve pass recognizes and turns into
    the island's error slot. Nothing else changes: the original promise still rejects, still
    carries the rejection handler that records it for the status derivation, and the wire
    section is filled from there.

    The twins are keyed by the promise rather than kept on the cell, because `use()` needs
    one identity across the level's resume and a *hook* load has no cached cell to hold one
    — it re-classifies its result on every render.
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
