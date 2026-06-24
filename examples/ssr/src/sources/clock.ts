import { observable, runInAction } from 'mobx';
import { SourceSymbol, type Source, type SourceState } from 'rati';

/**
 * A live clock as a rati `Source`: pending until attached, then ticking once a
 * second. A source's `state` is a MobX-observable derivation the island reads
 * inside an `observer`, so each tick re-renders.
 *
 * Sources stay *pending* under SSR — `attach()` runs from an effect, and effects
 * don't run during the server `prerender` — so the island renders its loading slot
 * in the HTML and the clock only starts after hydration. `attach`'s returned
 * cleanup clears the interval when the island unmounts (e.g. navigating away).
 */
export function clockSource(): Source<string> {
    const box = observable.box<SourceState<string>>({ status: 'pending' }, { deep: false });
    const now = () => new Date().toLocaleTimeString('en-US', { hour12: false });
    return {
        [SourceSymbol]: true,
        get state() {
            return box.get();
        },
        attach() {
            runInAction(() => box.set({ status: 'ready', value: now() }));
            const id = setInterval(() => {
                runInAction(() => box.set({ status: 'ready', value: now() }));
            }, 1000);
            return () => {
                clearInterval(id);
                runInAction(() => box.set({ status: 'pending' }));
            };
        },
    };
}
