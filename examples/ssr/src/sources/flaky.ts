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
 * A deliberately flaky service as a `Source`. Every odd attempt fails — mapped
 * through `toSourceError` to the unified `error` state with a machine-readable
 * `code` — and every even attempt succeeds. So the island shows its error slot
 * first, and the slot's `retry` (which remounts the inner tree → a fresh source)
 * recovers. Pending under SSR, so the server render emits the loading slot.
 *
 * A `subscribe` / `getSnapshot` pair (the uSES-shaped Source contract): `attach`
 * stores the terminal state and notifies, and `getSnapshot` returns it.
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
