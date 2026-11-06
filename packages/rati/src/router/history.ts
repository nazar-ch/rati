import { navTrace } from '../util/navTrace.js';

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
    /**
     * Traverses the entry stack by `delta` entries, landing on an existing entry — with its
     * own `state` and `key` — as a POP. Out of range does nothing, never clamping; `delta: 0`
     * reloads the browser and does nothing in memory. The memory history emits before `go`
     * returns, the browser on a later task.
     */
    go(delta: number): void;
    /** `go(-1)`. */
    back(): void;
    /** `go(1)`. */
    forward(): void;
    listen(listener: HistoryListener): () => void;
    /**
     * Manually fan out a history update to all listeners. For external
     * navigations (e.g. the Navigation API intercepting a click) where the URL
     * is updated outside our `push`/`replace`, callers can use this to keep
     * subscribers like scroll restoration in sync.
     */
    notify(action: Action): void;
    /**
     * Detaches from the host and drops every listener. `createBrowserHistory`'s `popstate`
     * subscription outlives the object, so a history per test or HMR cycle leaks without it.
     * `RouterStore.dispose()` calls it on a history it created; an injected one is its
     * caller's.
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
        // Traversal is the browser's own: it owns the entry stack, so we ask and
        // wait. The POP comes back through the `popstate` listener above, on a
        // later task — there is nothing to emit here.
        go(delta) {
            window.history.go(delta);
        },
        back() {
            window.history.back();
        },
        forward() {
            window.history.forward();
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
 * In-memory history for hosts without a DOM — server rendering, tests. Mirrors
 * {@link History} over an entry stack in a closure, so back/forward restore real entries
 * with their own `state` and `key`; traversal emits synchronously.
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

    // Oldest first; `index` is where we are. Everything after it is the forward
    // tail reachable by `go(+n)` until a `push` cuts it off.
    let entries: Location[] = [parse(opts.url ?? '/', null, newKey())];
    let index = 0;

    function emit(action: Action) {
        const location = entries[index]!;
        for (const l of listeners) l({ location, action });
    }

    function go(delta: number) {
        const target = index + delta;
        if (delta === 0 || target < 0 || target >= entries.length) return;
        index = target;
        // The entry is restored, not rebuilt: `emit` reads it back out of the
        // stack with the `state` and `key` it was pushed with.
        emit('POP');
    }

    return {
        get location() {
            return entries[index]!;
        },
        push(to, state = null) {
            // Pushing from anywhere but the tip drops the forward tail — those
            // entries are no longer reachable, exactly as in the browser.
            entries = entries.slice(0, index + 1);
            entries.push(parse(to, state, newKey()));
            index = entries.length - 1;
            emit('PUSH');
        },
        replace(to, state = null) {
            // Swap in place: the stack neither grows nor loses its forward tail.
            // A fresh key, matching createBrowserHistory's replace — the entry now
            // holds a different page, so scroll restoration must not hand it the
            // position saved for the one it replaced.
            entries[index] = parse(to, state, newKey());
            emit('REPLACE');
        },
        go,
        back() {
            go(-1);
        },
        forward() {
            go(1);
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
