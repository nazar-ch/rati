import { SourceSymbol, type Source, type SourceState } from 'rati';

/**
 * A live clock as a rati `Source`: pending until attached, then ticking once a
 * second. Pending under SSR, where no effect runs `attach()`, so the server HTML
 * carries the loading slot.
 */
export function clockSource(): Source<string> {
    let state: SourceState<string> = { status: 'pending' };
    const listeners = new Set<() => void>();
    const set = (next: SourceState<string>) => {
        state = next;
        for (const listener of listeners) listener();
    };
    const now = () => new Date().toLocaleTimeString('en-US', { hour12: false });
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
            set({ status: 'ready', value: now() });
            const id = setInterval(() => set({ status: 'ready', value: now() }), 1000);
            return () => {
                clearInterval(id);
                set({ status: 'pending' });
            };
        },
    };
}
