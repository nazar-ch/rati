import { navTrace } from '../util/navTrace';

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
    /**
     * Manually fan out a history update to all listeners. For external
     * navigations (e.g. the Navigation API intercepting a click) where the URL
     * is updated outside our `push`/`replace`, callers can use this to keep
     * subscribers like scroll restoration in sync.
     */
    notify(action: Action): void;
    /**
     * Detach from the host and drop every listener; the history is inert
     * afterwards. `createBrowserHistory` subscribes to `window`'s `popstate`,
     * which outlives the history object itself — without this, a history per
     * test or per HMR cycle leaves its subscription behind.
     *
     * `RouterStore.dispose()` calls it on a history it created; an injected one
     * is the caller's to dispose, since they may share or outlive the store.
     * Optional: a host with nothing to detach need not implement it.
     */
    dispose?(): void;
}

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

    function emit(action: Action) {
        const location = readLocation();
        for (const l of listeners) l({ location, action });
    }

    const onPopState = () => emit('POP');
    window.addEventListener('popstate', onPopState);

    return {
        // Read fresh on every access so Navigation API interceptions and other
        // out-of-band URL updates are reflected without us having to be told.
        get location() {
            return readLocation();
        },
        push(to, state = null) {
            const internal: InternalState = { usr: state, key: newKey() };
            window.history.pushState(internal, '', to);
            navTrace(`history.push → ${to} (URL bar set)`);
            emit('PUSH');
        },
        replace(to, state = null) {
            const internal: InternalState = { usr: state, key: newKey() };
            window.history.replaceState(internal, '', to);
            navTrace(`history.replace → ${to}`);
            emit('REPLACE');
        },
        listen(listener) {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
        notify: emit,
        dispose() {
            window.removeEventListener('popstate', onPopState);
            listeners.clear();
        },
    };
}

/**
 * In-memory history for environments without a DOM (server rendering, tests,
 * non-browser hosts). Mirrors the {@link History} surface but holds the
 * current location in a closure variable instead of `window.history`. No
 * `popstate` listeners; back/forward navigation is not modeled.
 */
export function createMemoryHistory(opts: { url?: string } = {}): History {
    const listeners = new Set<HistoryListener>();

    function parse(url: string, state: unknown, key: string): Location {
        // Placeholder origin lets us reuse the URL parser for relative inputs.
        const parsed = new URL(url, 'http://_');
        return {
            pathname: parsed.pathname,
            search: parsed.search,
            hash: parsed.hash,
            state,
            key,
        };
    }

    let current = parse(opts.url ?? '/', null, newKey());

    function emit(action: Action) {
        for (const l of listeners) l({ location: current, action });
    }

    return {
        get location() {
            return current;
        },
        push(to, state = null) {
            current = parse(to, state, newKey());
            emit('PUSH');
        },
        replace(to, state = null) {
            current = parse(to, state, newKey());
            emit('REPLACE');
        },
        listen(listener) {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
        notify: emit,
        dispose() {
            // Nothing to detach from — there is no host. Dropping the listeners
            // still matters: it keeps the surface total, so a caller can dispose
            // any History without asking which kind it holds.
            listeners.clear();
        },
    };
}
