import type { Source } from '../scope/source.js';

/**
 * Wraps an SSR-marked source's first settle into a promise, so the server resolves it
 * through `use()` like a promise load. Attaches during render, as the `ssr` marker
 * authorizes, and detaches once settled; a source that never settles hangs the prerender.
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
