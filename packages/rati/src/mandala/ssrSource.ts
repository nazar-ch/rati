import type { Source } from '../scope/source';

/**
 * Wrap an SSR-marked source's first settle into a promise, so the server resolves it
 * through React's own wait mechanics (`use()` / Suspense / `prerender`) exactly like a
 * promise load. Attaches during render — that is what the `ssr` marker authorizes — and
 * detaches once settled. The trust extended is the same as for any promise load: a
 * state machine that never settles hangs the prerender (budgets belong to the prerender
 * helper, not here).
 */
export function firstSettle<T>(source: Source<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        let done = false;
        let cleanup: (() => void) | null = null;
        const check = (): void => {
            if (done) return;
            const state = source.getSnapshot();
            if (state.status === 'pending') return;
            done = true;
            if (cleanup) {
                cleanup();
                cleanup = null;
            }
            if (state.status === 'ready') resolve(state.value);
            // A plain SourceError is the mandala's error convention — the boundary's
            // asSourceError takes it as-is (an Error wrapper would erase its `code`).
            // oxlint-disable-next-line typescript/prefer-promise-reject-errors
            else reject(state.error);
        };
        const unsubscribe = source.subscribe(check);
        const detach = source.attach();
        cleanup = () => {
            unsubscribe();
            detach();
        };
        // Settled synchronously during attach (before cleanup existed) — or already
        // settled before we ever attached: run/settle now.
        if (done) {
            cleanup();
            cleanup = null;
        } else {
            check();
        }
    });
}
