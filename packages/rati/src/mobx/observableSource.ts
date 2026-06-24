import { _allowStateReadsEnd, _allowStateReadsStart, reaction } from 'mobx';
import { SourceSymbol, type Source, type SourceState } from '../scope/source';

/*
    Adapt a MobX observable derivation to a rati `Source` (the `rati/mobx` surface).

    rati core is MobX-free: a `Source` is a `useSyncExternalStore`-shaped
    `subscribe` / `getSnapshot` pair. This bridges a MobX world — where state lives
    in observables and you'd read it inside an `observer` — onto that contract, so an
    app that models its data in MobX keeps doing so and only its source boundary
    changes (the resolver never learns MobX is behind it).

      - `getSnapshot` reads the derivation, memoized: it returns the *same*
        SourceState reference until the logical state changes, because uSES compares
        snapshots by identity and a derivation that builds a fresh `{ status, value }`
        each read would otherwise loop.
      - `subscribe` is a MobX `reaction` over the same derivation: it fires the uSES
        callback whenever a tracked observable changes.
      - `attach` is yours: start/stop the underlying work (a load, a timer, a grab)
        and return its teardown. Defaults to a no-op for an already-live derivation.
*/
export function observableSource<T>(
    getState: () => SourceState<T>,
    attach: () => () => void = () => () => {},
): Source<T> {
    let cached: SourceState<T> | undefined;
    const getSnapshot = (): SourceState<T> => {
        // uSES calls getSnapshot during render — outside any MobX reaction — so the
        // observable reads in `getState` would trip `observableRequiresReaction`.
        // They're deliberate (subscribe sets up the real tracking reaction); flag the
        // window as a permitted state read, the same hook MobX uses internally for
        // its own out-of-derivation reads.
        const prevAllowReads = _allowStateReadsStart(true);
        try {
            const next = getState();
            if (cached && sameState(cached, next)) return cached;
            cached = next;
            return next;
        } finally {
            _allowStateReadsEnd(prevAllowReads);
        }
    };
    return {
        [SourceSymbol]: true,
        getSnapshot,
        // `reaction` tracks the observables `getState` reads and re-runs `onChange`
        // when they change; `getSnapshot` then hands uSES the (memoized) new state.
        subscribe: (onChange) => reaction(getState, onChange),
        attach,
    };
}

// uSES-stability comparison for the 3 SourceState variants: pending always equal;
// ready by value identity (a live store/value keeps its reference until it really
// changes); error by code + message. Lets a derivation rebuild its state object
// each read without forcing a re-render when nothing logically changed.
function sameState<T>(a: SourceState<T>, b: SourceState<T>): boolean {
    if (a.status !== b.status) return false;
    if (a.status === 'ready' && b.status === 'ready') return Object.is(a.value, b.value);
    if (a.status === 'error' && b.status === 'error') {
        return a.error.code === b.error.code && a.error.message === b.error.message;
    }
    return true;
}
