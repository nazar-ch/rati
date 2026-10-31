import { _allowStateReadsEnd, _allowStateReadsStart } from 'mobx';

/**
 * Runs `read` with MobX's state reads allowed, its tracking left as the caller's: an imperative
 * entry point such as `prime()` runs outside any reaction, where a bare read trips
 * `observableRequiresReaction`.
 */
export function readOutsideReaction<T>(read: () => T): T {
    const previous = _allowStateReadsStart(true);
    try {
        return read();
    } finally {
        _allowStateReadsEnd(previous);
    }
}
