import { SourceSymbol, type Source, type SourceState } from 'rati';

/**
 * A live clock as a rati `Source`: pending until attached, then ticking once a
 * second. The source is a `subscribe` / `getSnapshot` pair (the uSES-shaped Source
 * contract) — each tick stores a new state object and notifies, so the island
 * re-renders. `getSnapshot` returns the stored object (stable identity until the
 * next tick), as uSES requires.
 *
 * Sources stay *pending* under SSR — `attach()` runs from an effect, and effects
 * don't run during the server `prerender` — so the island renders its loading slot
 * in the HTML and the clock only starts after hydration. `attach`'s returned
 * cleanup clears the interval when the island unmounts (e.g. navigating away).
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
