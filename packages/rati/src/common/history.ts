/**
 * Tiny native history abstraction over `window.history` and `popstate`.
 *
 * Two flavors:
 * - `browser`: pushes real URLs. Requires the host to serve the SPA at every
 *   path (e.g. SPA fallback in dev/production server).
 * - `hash`: encodes the route in `location.hash`. Works under `file://`, which
 *   is the common case for Electron apps loading bundled assets.
 *
 * `createHistory()` auto-detects: `file:` protocol → `hash`, otherwise `browser`.
 */

export type Action = 'PUSH' | 'REPLACE' | 'POP';

export interface Location {
    pathname: string;
    search: string;
    hash: string;
    /** User-supplied state passed to `push`/`replace`. */
    state: unknown;
    /** Stable identifier for this history entry. Used for scroll restoration. */
    key: string;
}

export interface HistoryUpdate {
    location: Location;
    action: Action;
}

export type HistoryListener = (update: HistoryUpdate) => void;

export interface History {
    readonly location: Location;
    push(to: string, state?: unknown): void;
    replace(to: string, state?: unknown): void;
    listen(listener: HistoryListener): () => void;
}

export type HistoryType = 'browser' | 'hash';

interface InternalState {
    usr: unknown;
    key: string;
}

let keyCounter = 0;
function newKey(): string {
    return `${Date.now().toString(36)}-${(++keyCounter).toString(36)}`;
}

function readInternalState(raw: unknown): InternalState {
    if (raw && typeof raw === 'object' && 'key' in raw && 'usr' in raw) {
        return raw as InternalState;
    }
    // Initial entry, or an entry created outside our control (e.g. a manual
    // pushState by a third party). Synthesize a key so scroll restoration has
    // something stable to key off of.
    return { usr: raw ?? null, key: 'default' };
}

export function createBrowserHistory(): History {
    const listeners = new Set<HistoryListener>();

    function readLocation(): Location {
        const { pathname, search, hash } = window.location;
        const { usr, key } = readInternalState(window.history.state);
        return { pathname, search, hash, state: usr, key };
    }

    let current = readLocation();

    function emit(action: Action) {
        current = readLocation();
        for (const l of listeners) l({ location: current, action });
    }

    window.addEventListener('popstate', () => emit('POP'));

    return {
        get location() {
            return current;
        },
        push(to, state = null) {
            const internal: InternalState = { usr: state, key: newKey() };
            window.history.pushState(internal, '', to);
            emit('PUSH');
        },
        replace(to, state = null) {
            const internal: InternalState = { usr: state, key: newKey() };
            window.history.replaceState(internal, '', to);
            emit('REPLACE');
        },
        listen(listener) {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
    };
}

export function createHashHistory(): History {
    const listeners = new Set<HistoryListener>();

    function readLocation(): Location {
        const raw = window.location.hash.slice(1) || '/';
        // Parse the hash value as a URL so we get pathname/search/hash split for free.
        // The placeholder origin is discarded.
        const url = new URL(raw, 'http://_');
        const { usr, key } = readInternalState(window.history.state);
        return {
            pathname: url.pathname,
            search: url.search,
            hash: url.hash,
            state: usr,
            key,
        };
    }

    let current = readLocation();

    function emit(action: Action) {
        current = readLocation();
        for (const l of listeners) l({ location: current, action });
    }

    // Back/forward — covers both browser navigation and external hash changes.
    window.addEventListener('popstate', () => emit('POP'));

    function buildUrl(to: string): string {
        const url = new URL(window.location.href);
        url.hash = '#' + to;
        return url.toString();
    }

    return {
        get location() {
            return current;
        },
        push(to, state = null) {
            const internal: InternalState = { usr: state, key: newKey() };
            window.history.pushState(internal, '', buildUrl(to));
            emit('PUSH');
        },
        replace(to, state = null) {
            const internal: InternalState = { usr: state, key: newKey() };
            window.history.replaceState(internal, '', buildUrl(to));
            emit('REPLACE');
        },
        listen(listener) {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
    };
}

export function createHistory(opts: { type?: HistoryType } = {}): History {
    const type = opts.type ?? (window.location.protocol === 'file:' ? 'hash' : 'browser');
    return type === 'hash' ? createHashHistory() : createBrowserHistory();
}
