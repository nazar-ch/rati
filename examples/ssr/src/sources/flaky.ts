import { observable, runInAction } from 'mobx';
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
 */
export function flakyService(): Source<string> {
    const box = observable.box<SourceState<string>>({ status: 'pending' }, { deep: false });
    return {
        [SourceSymbol]: true,
        get state() {
            return box.get();
        },
        attach() {
            const mine = ++attempt;
            const id = setTimeout(() => {
                runInAction(() => {
                    if (mine % 2 === 1) {
                        box.set({
                            status: 'error',
                            error: toSourceError(
                                new NotAvailableError('flaky service is warming up', {
                                    code: 'unavailable',
                                }),
                            ),
                        });
                    } else {
                        box.set({ status: 'ready', value: `connected on attempt #${mine}` });
                    }
                });
            }, 650);
            return () => clearTimeout(id);
        },
    };
}
