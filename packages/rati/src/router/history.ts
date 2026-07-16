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
    /**
     * Traverse the entry stack by `delta` entries — the back/forward buttons,
     * programmatically. Lands on an existing entry, so the location it restores
     * carries that entry's own `state` and `key` rather than fresh ones, and the
     * update arrives as `POP`.
     *
     * Out of range does nothing (the browser's rule: there is no entry to go to,
     * so no traversal happens — it does not clamp to the ends). `delta: 0` is the
     * host's reload: the browser reloads the document; a memory history has no
     * document, so it does nothing.
     *
     * **The two implementations differ in *when* the POP arrives.** The memory
     * history owns its stack and emits synchronously, before `go` returns. The
     * browser's traversal is asynchronous — `window.history.go` queues it, and the
     * `popstate` event (and so the update) arrives on a later task. Code that must
     * work on both awaits the listener rather than reading `location` on the next
     * line.
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
 * In-memory history for environments without a DOM (server rendering, tests,
 * non-browser hosts). Mirrors the {@link History} surface over an entry stack
 * held in a closure instead of `window.history`, so back/forward traverse real
 * entries — {@link History.go} restores the entry's own `state` and `key`, which
 * is what scroll restoration and per-entry `state` key off. No `popstate`
 * listeners: the stack is ours, so traversal emits synchronously.
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
