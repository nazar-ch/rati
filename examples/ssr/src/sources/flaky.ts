import {
    NotAvailableError,
    SourceSymbol,
    toSourceError,
    type Source,
    type SourceState,
} from 'rati';

// Bumped only inside attach(), which runs on the client (effects don't run during
// the SSR prerender) — so this never leaks state between server requests.
let attempt = 0;

/**
 * A flaky service as a `Source`: every odd attempt fails, so the island shows its
 * error slot first, and the slot's `retry`, which remounts a fresh source, recovers.
 * Pending under SSR, so the server HTML carries the loading slot.
 */
export function flakyService(): Source<string> {
    let state: SourceState<string> = { status: 'pending' };
    const listeners = new Set<() => void>();
    const set = (next: SourceState<string>) => {
        state = next;
        for (const listener of listeners) listener();
    };
    return {
        [SourceSymbol]: true,
        getSnapshot: () => state,
        subscribe(onChange) {
            listeners.add(onChange);
            return () => {
                listeners.delete(onChange);
            };
        },
        attach() {
            const mine = ++attempt;
            const id = setTimeout(() => {
                if (mine % 2 === 1) {
                    set({
                        status: 'error',
                        error: toSourceError(
                            new NotAvailableError('flaky service is warming up', {
                                code: 'unavailable',
                            }),
                        ),
                    });
                } else {
                    set({ status: 'ready', value: `connected on attempt #${mine}` });
                }
            }, 650);
            return () => clearTimeout(id);
        },
    };
}
