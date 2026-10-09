import { _allowStateReadsEnd, _allowStateReadsStart, reaction } from 'mobx';

import { SourceSymbol, type Source, type SourceSSR, type SourceState } from '../scope/source.js';

/**
 * Adapts a MobX observable derivation to a rati `Source`. `getSnapshot` returns the same
 * `SourceState` until the logical state changes; `subscribe` is a MobX `reaction` over the
 * derivation; `attach` starts the underlying work and returns its teardown, a no-op by default.
 */
export function observableSource<T>(
    getState: () => SourceState<T>,
    attach: () => () => void = () => () => {},
    options?: { ssr?: SourceSSR<T> },
): Source<T> {
    let cached: SourceState<T> | undefined;
    const getSnapshot = (): SourceState<T> => {
        // uSES calls getSnapshot during render, outside any reaction, where `getState`'s reads
        // trip `observableRequiresReaction`; this is the hook MobX uses for its own
        // out-of-derivation reads.
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
        subscribe: (onChange) => reaction(getState, onChange),
        attach,
        ...(options?.ssr !== undefined && { ssr: options.ssr }),
    };
}

// uSES stability: pending always equal, ready by value identity, error by code and message —
// so a derivation rebuilding its state object each read forces no re-render.
function sameState<T>(a: SourceState<T>, b: SourceState<T>): boolean {
    if (a.status !== b.status) return false;
    if (a.status === 'ready' && b.status === 'ready') return Object.is(a.value, b.value);
    if (a.status === 'error' && b.status === 'error') {
        return a.error.code === b.error.code && a.error.message === b.error.message;
    }
    return true;
}
