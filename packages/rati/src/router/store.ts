import { createBrowserHistory, type History, type Location } from './history';
import { navTrace } from '../util/navTrace';
import { installScrollRestoration, type ScrollRestorationOptions } from './scrollRestoration';
import { GlobalStore } from '../stores/GlobalStore';
import { PARAM_RE, type GenericRouteType, type NameToRoute } from './route';

// Redirect chains longer than this are treated as a cycle (see setPath).
const MAX_REDIRECT_DEPTH = 10;

type GetActiveRoute = ReturnType<RouterStore<GenericRouteType[]>['getActiveRoute']>;

/** Activated route shape. */
type ActiveRoute = NonNullable<GetActiveRoute>;

/**
 * Snapshot used to seed a router on the client after server rendering. Mirrors
 * what the server entry serialized into the HTML response — the client passes it
 * back so the first paint reads the same active route as the server. This is the
 * *routing* snapshot only; a route's resolved scope data is dehydrated separately
 * by the mandala engine (see `HydrationProvider` in `rati/ssr`).
 */
export interface RouterHydratedState {
    path: string;
    search: string;
    hash: string;
    /** `name` of the route definition that was matched on the server. */
    activeRouteName: string;
    routeParams: Record<string, string>;
}

export interface RouterStoreOptions {
    /**
     * Inject a {@link History} instance instead of letting the store create
     * one. Pair with `createMemoryHistory({ url })` for server rendering or
     * any other host that doesn't have a DOM.
     */
    history?: History;
    /**
     * Configure or disable SPA scroll restoration. Set to `false` to opt out
     * (e.g. if the host app already manages its own scroll). Pass an object
     * to customize the "scroll to top" behavior. Defaults to enabled with
     * `window.scrollTo(0, 0)` on PUSH/REPLACE.
     */
    scrollRestoration?: false | ScrollRestorationOptions;
    /**
     * URL prefix the app is mounted under, e.g. `/admin`. Stripped before route
     * matching and prepended when generating link `href` values, so route
     * definitions stay rooted at `/`. Must start with `/` and not end with `/`.
     */
    basename?: string;
    /**
     * Pre-resolved router state from a server render. When provided, the store
     * seeds `path`, `search`, `hash`, and `activeRoute` synchronously from this
     * snapshot and skips the initial `setPath`/`getActiveRoute` async work, so
     * the first client render matches the server HTML byte-for-byte.
     */
    hydratedState?: RouterHydratedState | undefined;
}

function normalizeBasename(basename: string | undefined): string {
    if (!basename) return '';
    if (!basename.startsWith('/')) {
        throw new Error(`basename must start with "/", got "${basename}"`);
    }
    return basename.endsWith('/') ? basename.slice(0, -1) : basename;
}

function stripBasename(pathname: string, basename: string): string {
    if (!basename) return pathname;
    if (pathname === basename) return '/';
    if (pathname.startsWith(basename + '/')) return pathname.slice(basename.length);
    // Pathname doesn't live under basename — return as-is so the route matcher
    // gets a chance to fall through to a 404 catch-all if one is defined.
    return pathname;
}

/**
 * The pathname a redirect target names, in the same terms `setPath` resolves in: query
 * and fragment dropped, basename stripped. Comparing the two is what catches a redirect
 * pointing back at the route that declared it (see {@link RouterStore.setPath}).
 */
function redirectTargetPathname(targetPath: string, basename: string): string {
    const pathname = targetPath.split('?')[0]!.split('#')[0]!;
    return stripBasename(pathname, basename);
}

/**
 * The router's string vocabulary is absolute path references; anything else is refused
 * here, at the choke point, rather than misnavigating quietly.
 *
 * A relative string has no single meaning in this router. The platform resolves one
 * against the current URL, but only in the browser: `createMemoryHistory` parses every
 * input against a fixed placeholder origin, so the two hosts disagree on every relative
 * spelling — `push('sub')` from `/a/b/c` is `/a/b/sub` in the browser and `/sub` in
 * memory, and SSR, tests and the fuzz model all run on the latter. Teaching both to
 * resolve was the alternative; refusing is the decision, because two hosts can only
 * disagree about input we accept. It also closes a trap the spelling opened: a
 * self-targeting redirect written relatively (`to: 'self'` on `/self`) walked past the
 * loop check, which compares resolutions and saw `'self' !== '/self'`.
 *
 * Where a relative reference is genuinely meant, `<Link>`/an anchor is the surface that
 * owns it — the platform resolves it there, and the router receives the answer.
 */
function assertAbsolutePathTarget(target: string, where: string): void {
    if (target.startsWith('/')) return;
    throw new Error(
        `[rati] ${where}: "${target}" is not an absolute path. Router-facing strings must ` +
            `start with "/" — the router does not resolve a reference against the current URL. ` +
            `Name a route ({ name: … }, or getPath) to have the table build the path, use ` +
            `setSearchParams() to change the query, or put the reference on a <Link>/an anchor, ` +
            `where the platform resolves it.`,
    );
}

/**
 * Percent-decode the matched params — the inbound half of the round-trip `getPath`
 * opens, so a component reads the value that was put in rather than the browser's
 * encoding of it (`hello world`, not `hello%20world`).
 *
 * A URL is user input: hand-typed, truncated, or copied wrong, it can carry a sequence
 * `decodeURIComponent` rejects (`/pages/%zz`). Decoding runs during `setPath`, so
 * letting the URIError fly would turn a bad address into a dead app; the raw segment is
 * handed through instead — the component sees exactly what the URL said — and the
 * problem is reported rather than swallowed.
 */
function decodeParams(groups: Record<string, string | undefined> | undefined) {
    const params: Record<string, string> = {};
    for (const [key, value] of Object.entries(groups ?? {})) {
        if (value === undefined) continue;
        try {
            params[key] = decodeURIComponent(value);
        } catch {
            console.warn(
                `[rati] route param "${key}" is not valid percent-encoding ("${value}") — ` +
                    `using it undecoded.`,
            );
            params[key] = value;
        }
    }
    return params;
}

/**
 * Shallow value-equality for per-entry history `state`. Used to decide whether a
 * same-URL navigation changed its `state` and so should re-resolve the route
 * (see {@link RouterStore.setPath}). Reference equality is wrong here: POP
 * restores `state` as a freshly-deserialized object, and StrictMode re-reads
 * `history.state` into a new object too — both must compare equal to their prior
 * value. A shallow compare matches `state`'s documented purpose (flat UI-local
 * context like `{ panelId }`); deeply-nested changes are out of scope by design.
 */
function shallowEqualState(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (typeof a !== 'object' || a === null || typeof b !== 'object' || b === null) {
        return false;
    }
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    if (aKeys.length !== bKeys.length) return false;
    for (const key of aKeys) {
        if ((a as Record<string, unknown>)[key] !== (b as Record<string, unknown>)[key]) {
            return false;
        }
    }
    return true;
}

export class RouterStore<
    T extends readonly GenericRouteType[] = readonly GenericRouteType[],
> extends GlobalStore<any> {
    history: History;

    unlistenHistory: () => void;
    /**
     * Whether this store created its own history, and so must dispose it. An
     * injected one belongs to whoever passed it in — it may be shared between
     * stores or outlive this one.
     */
    private readonly ownsHistory: boolean;
    /** Normalized basename — empty string when none was configured. */
    readonly basename: string;
    /**
     * Always-resolved sentinel kept for backwards compatibility with server
     * entries that `await` it before reading `activeRoute`. Navigation is now
     * synchronous, so `activeRoute` is populated by the time the constructor
     * returns and awaiting this is a no-op.
     */
    pendingNavigation: Promise<void> = Promise.resolve();
    private uninstallScrollRestoration: () => void = () => {};

    // useSyncExternalStore subscription. Navigation is infrequent, so a single
    // version counter bumped on every change (re-rendering each router consumer) is
    // enough — no per-field selectors. `subscribe`/`getSnapshot` are arrow fields so
    // their identity stays stable across renders, as uSES requires.
    private listeners = new Set<() => void>();
    private version = 0;
    readonly subscribe = (onChange: () => void): (() => void) => {
        this.listeners.add(onChange);
        return () => {
            this.listeners.delete(onChange);
        };
    };
    readonly getSnapshot = (): number => this.version;
    private emitChange() {
        this.version++;
        // Set iteration tolerates a listener unsubscribing mid-notify, so iterate directly.
        for (const listener of this.listeners) listener();
    }

    constructor(
        stores: any,
        public routes: T,
        options: RouterStoreOptions = {},
    ) {
        super(stores);

        this.basename = normalizeBasename(options.basename);

        const listener = ({ location }: { location: Location }) => {
            this.setPath(location);
        };

        if (options.history) {
            this.history = options.history;
            this.ownsHistory = false;
        } else {
            this.history = createBrowserHistory();
            this.ownsHistory = true;
        }
        this.unlistenHistory = this.history.listen(listener);

        if (options.scrollRestoration !== false) {
            this.uninstallScrollRestoration = installScrollRestoration(
                this.history,
                options.scrollRestoration ?? {},
            );
        }

        if (options.hydratedState) {
            // Server-rendered snapshot — seed observables so the first client
            // render matches the server HTML. The route is already resolved.
            this.seedFromHydratedState(options.hydratedState);
        } else {
            // Set path where the page is opened
            this.setPath(this.history.location);
        }
    }

    private seedFromHydratedState(state: RouterHydratedState) {
        const matched = this.routes.find((r) => r.name === state.activeRouteName);
        if (!matched) {
            // The hydrated route name doesn't exist in this client's route table
            // (e.g. server and client routes drifted). Fall back to running the
            // normal matcher against the URL so we at least render *something*.
            // Don't seed _path here so setPath's same-path early-return doesn't
            // skip the resolve.
            this.setPath(this.history.location);
            return;
        }

        this._path = state.path;
        this._search = state.search;
        this._hash = state.hash;
        // Match setPath's convention: bump the counter and use the new value
        // as the activeRoute key, so subsequent navigations always get a
        // different value and React remounts the route component.
        this.pathCounter++;
        this.activeRoute = {
            name: matched.name,
            component: matched.component,
            wrapperComponent: matched.wrapperComponent,
            path: matched.path,
            routeParams: state.routeParams,
            redirect: matched.redirect,
            pathCounter: this.pathCounter,
        };
        this.emitChange();
    }

    dispose() {
        this.unlistenHistory();
        this.uninstallScrollRestoration();
        // Unlistening only detaches *this* store; the history it created is still
        // holding the window's popstate. Nobody else can let go of it.
        if (this.ownsHistory) this.history.dispose?.();
    }

    getPath(args: NameToRoute<T> | string) {
        if (typeof args === 'string') {
            // String paths are passed through verbatim (basename is the caller's
            // responsibility here — they may already have the full URL). Not held to the
            // absolute-path rule `navigate`/`replace` enforce, on purpose: this output
            // feeds `href` attributes (the ContextualLink path), and an anchor is the one
            // surface where a relative reference is legal — the platform resolves it there
            // and the router only ever sees the resolved answer (see Link's anchorPath).
            return args;
        }

        const { name, ...params } = args;
        const matched = this.routes.find((item) => item.name === name);
        if (!matched) {
            throw new Error(
                `[rati] getPath: no route named "${name}". ` +
                    `Known routes: ${this.routes.map((item) => item.name).join(', ')}.`,
            );
        }
        // Substitute at the path's own `:param` boundaries (PARAM_RE — the same tokens
        // the matcher compiles), so a name can never be found inside a longer one.
        // Values are percent-encoded, which is the outbound half of the round-trip
        // getActiveRoute closes: what the caller passes here is what the component is
        // handed back, whatever characters it contains — save one shape no encoding
        // reaches. A value of exactly '.' or '..' is a path operator, not data: the URL
        // parser resolves the segment away before any router sees it, and `%2E` is not an
        // escape from that (URLs read it as a dot for precisely this reason — it is what
        // stops percent-encoding from smuggling a traversal past a path check). No URL
        // carries such a value, so getPath refuses it instead of building one that
        // resolves somewhere else — see docs/public/reference.md §Routing.
        const path = matched.path.replace(PARAM_RE, (token, key: string, tail: string) => {
            const value = (params as Record<string, string | undefined>)[key];
            // Types require every param, so a missing one means a caller reaching past
            // them; leave the token in place rather than interpolating "undefined".
            if (value === undefined) return token;
            if (value === '.' || value === '..') {
                throw new Error(
                    `[rati] getPath: route "${name}" param "${key}" is "${value}" — no URL ` +
                        `can carry a dot-only value. Put it in the query string, or map it to an id.`,
                );
            }
            return encodeURIComponent(value) + tail;
        });
        return this.basename + path;
    }

    get path() {
        return this._path;
    }

    /** The raw `?…` portion of the current URL, including the leading `?`. */
    get search() {
        return this._search;
    }

    /**
     * Parsed query string. The returned object is a fresh `URLSearchParams`
     * each time the underlying search changes — treat it as immutable. To
     * change params, use {@link setSearchParams}.
     */
    get searchParams() {
        return new URLSearchParams(this._search);
    }

    /** The `#…` portion of the current URL, including the leading `#`. */
    get hash() {
        return this._hash;
    }

    /**
     * User state attached to the current history entry via `navigate`/`replace`
     * `{ state }`, or `null`. The browser persists it per entry, so it survives
     * back/forward. Use it to carry UI-local context that shouldn't live in the
     * URL itself — e.g. which panel a navigation targets.
     *
     * A navigation that changes only `state` (same URL, different value) still
     * re-resolves the active route, so consumers that route off `state` react to
     * back/forward between two entries sharing a URL. See {@link setPath}.
     */
    get state(): unknown {
        return this._state;
    }

    isPath(path: string) {
        // `path` here is a URL path (the value returned by getPath, used in href
        // attributes), so strip the basename before comparing against the
        // route-internal `path`.
        return stripBasename(path, this.basename) === this.path;
    }

    /**
     * Begin loading the chunk for the route that matches `path`, without
     * navigating. No-op if the matched route's component is not a
     * preload-capable lazy component (see {@link lazy}). Safe to call
     * repeatedly — the underlying factory dedupes.
     *
     * Used by `<Link prefetch>` to start the import on hover/touch.
     */
    preloadRoute(path: string): Promise<unknown> | undefined {
        const stripped = stripBasename(path, this.basename);
        // Drop query and hash before matching — the regex only looks at pathname.
        const pathname = stripped.split('?')[0]!.split('#')[0]!;
        for (const r of this.routes) {
            const matches = r.pathRe ? r.pathRe.test(pathname) : true;
            if (matches) {
                const preload = (r.component as { preload?: () => Promise<unknown> }).preload;
                return typeof preload === 'function' ? preload() : undefined;
            }
        }
        return undefined;
    }

    private _path: string = '';
    private _search: string = '';
    private _hash: string = '';
    private _state: unknown = null;

    activeRoute: ActiveRoute | null = null;

    /**
     * The route-level redirects the *current* navigation followed, oldest first —
     * reset when a fresh navigation starts. `prepareRoute` reads it to report the 30x;
     * on the client it is normally invisible (the history entry was replaced).
     */
    redirectHops: { from: string; to: string; permanent: boolean }[] = [];
    private redirectDepth = 0;

    private pathCounter: number = 0;
    private readonly sessionId = globalThis.crypto?.randomUUID
        ? globalThis.crypto.randomUUID()
        : // for local development, and Node < 19 where globalThis.crypto is absent
          `${Math.random()}-${Math.random()}`;
    setPath(location: Location) {
        try {
            const { state } = location;
            const pathname = stripBasename(location.pathname, this.basename);
            // A fresh navigation clears the previous one's redirect trail; a nested
            // setPath (redirect being followed) appends to the current trail instead.
            if (this.redirectDepth === 0) this.redirectHops = [];
            const currentPathCounter = this.pathCounter++;
            const nextState = state ?? null;
            const stateChanged = !shallowEqualState(this._state, nextState);

            // Search, hash and state always update so observers see them, even on
            // hash-only or query-only navigations (or skipped shallow replaces) that
            // leave the route unchanged.
            this._search = location.search;
            this._hash = location.hash;
            this._state = nextState;

            // Skip resolution only when the URL didn't change, the per-entry state
            // is equal, AND we already have a resolved route. The path/route guard
            // covers the initial mount race and StrictMode re-fires (where _path was
            // set but activeRoute wasn't yet committed). The state guard is what
            // makes a state-only change re-resolve: stepping back/forward between two
            // entries that share a URL but carry different `state` (e.g. the same
            // page open in two panels) must re-key the active route so consumers
            // routing off it react — otherwise the entry change is invisible to them.
            if (this._path === pathname && this.activeRoute && !stateChanged) {
                return;
            }

            this._path = pathname;

            // Skip rendering the route if it was set by `replace({ keepCurrentRoute: true })`
            if (
                typeof state === 'object' &&
                state &&
                'skip' in state &&
                state['skip'] === `${currentPathCounter}/${this.sessionId}`
            ) {
                return;
            }

            const matched =
                this.getActiveRoute(
                    this.path,
                    this.stores as any,
                    // Using this number as `key` ensures that the route that was not
                    // skipped above will be rerendered
                    this.pathCounter,
                ) ?? null;

            // A route-level redirect is followed here, before the route ever renders:
            // resolve the target, record the hop (prepareRoute's 30x input), and
            // `replace` — the history listener fires synchronously, so the nested
            // setPath resolves the target route before this frame returns. The depth
            // guard breaks redirect cycles by rendering the last route instead.
            if (matched?.redirect && this.redirectDepth < MAX_REDIRECT_DEPTH) {
                const { to, permanent = false } = matched.redirect;
                const target = typeof to === 'function' ? to(matched.routeParams) : to;
                let targetPath: string;
                if (typeof target === 'string') {
                    // Refused before the hop is recorded or followed: a relative target is
                    // also how a self-redirect used to slip past the 1-cycle check below,
                    // which compares resolved pathnames and reads a spelling as different.
                    assertAbsolutePathTarget(target, `redirect from route "${matched.name}"`);
                    targetPath = target;
                } else {
                    targetPath = this.getPath(target as NameToRoute<T>) + this._search + this._hash;
                }
                this.redirectHops.push({ from: pathname, to: targetPath, permanent });
                // A target pointing back at the pathname being resolved is a cycle of
                // length 1, and following it cannot reveal that: the nested setPath sees
                // its own path unchanged, takes the same-path early return above, and
                // leaves the *previous* route on screen at the new URL. Stop here and
                // fall through to the loop report instead, so a 1-cycle ends the way a
                // capped longer one does — trail recorded, the route's own component
                // rendered. Search and hash are excluded from the comparison on purpose:
                // a target differing from its own route only in query is the same trap.
                if (redirectTargetPathname(targetPath, this.basename) !== pathname) {
                    this.redirectDepth++;
                    try {
                        this.replace(targetPath);
                    } finally {
                        this.redirectDepth--;
                    }
                    return;
                }
            }
            if (matched?.redirect) {
                console.error(
                    `[rati] redirect loop detected at "${pathname}" ` +
                        `(${this.redirectHops.map((hop) => hop.from).join(' → ')}) — ` +
                        `rendering the route's component instead of following further.`,
                );
            }

            this.activeRoute = matched;
            navTrace(`setPath → activeRoute=${this.activeRoute?.name ?? 'none'}`);
        } finally {
            // One notification per setPath regardless of which return ran —
            // search/hash/state always change, so consumers must re-read.
            this.emitChange();
        }
    }

    /**
     * Update the query string on the current URL. Defaults to `replace` so
     * tweaking filters/pagination doesn't grow the back stack; pass
     * `{ mode: 'push' }` to add a history entry instead.
     *
     * Accepts anything `URLSearchParams` accepts (object, string, entries).
     */
    setSearchParams(
        init: ConstructorParameters<typeof URLSearchParams>[0] | URLSearchParams,
        options: { mode?: 'push' | 'replace' } = {},
    ) {
        const params = init instanceof URLSearchParams ? init : new URLSearchParams(init as string);
        const search = params.toString();
        const url = this.basename + this._path + (search ? '?' + search : '') + this._hash;
        if (options.mode === 'push') {
            this.history.push(url);
        } else {
            this.history.replace(url);
        }
    }

    /**
     * Push (`navigate`) or replace (`replace`) a history entry, optionally
     * keeping the current route mounted. Shared core of {@link navigate} and
     * {@link replace} so the skip-marker assembly lives in one place.
     */
    private pushOrReplace(
        mode: 'push' | 'replace',
        to: NameToRoute<T> | string,
        options: { keepCurrentRoute?: boolean; state?: Record<string, unknown> },
    ) {
        let path: string;
        if (typeof to === 'string') {
            assertAbsolutePathTarget(to, mode === 'push' ? 'navigate' : 'replace');
            path = to;
        } else {
            path = this.getPath(to);
        }
        // The skip marker is consumed by the very next `setPath` (the synchronous
        // emit from this push/replace) to suppress re-resolution. It embeds the
        // current `pathCounter`, so a later POP back to this entry — where the
        // counter has moved on — finds it stale and re-resolves normally.
        const skip = options.keepCurrentRoute
            ? { skip: `${this.pathCounter}/${this.sessionId}` }
            : undefined;
        const state = skip || options.state ? { ...skip, ...options.state } : null;
        if (mode === 'push') {
            this.history.push(path, state);
        } else {
            this.history.replace(path, state);
        }
    }

    /**
     * Navigate to `to` by pushing a new history entry. The route re-resolves
     * and re-renders; browser back returns to the previous URL.
     *
     * Use for ordinary user-initiated navigation. `<Link>` calls this under
     * the hood. For programmatic redirects where the previous URL must not be
     * reachable via back (post-login, auth-gate, canonicalization), use
     * `replace()`.
     *
     * Pass `{ keepCurrentRoute: true }` for a *shallow push*: grow the back
     * stack and update the URL, but keep the currently mounted route component
     * in place (no re-resolve). Use when a history-worthy change leaves the
     * shown route valid — e.g. switching focus between split panels that each
     * already hold their content, where back/forward should step the focus.
     *
     * Pass `{ state }` to attach user state to the entry (readable via `state`,
     * survives back/forward). Coexists with `keepCurrentRoute`'s internal skip
     * marker.
     */
    navigate(
        to: NameToRoute<T> | string,
        options: { keepCurrentRoute?: boolean; state?: Record<string, unknown> } = {},
    ) {
        this.pushOrReplace('push', to, options);
    }

    /**
     * Navigate to `to` by replacing the current history entry. The route
     * re-resolves and re-renders, but browser back skips the previous URL.
     *
     * Use when the *previous* URL should not be reachable via back: post-login
     * redirects, auth-gate bounces, URL canonicalization (e.g. `/users` →
     * `/users/1`), navigation after a destructive action.
     *
     * Pass `{ keepCurrentRoute: true }` to update the URL without re-resolving
     * the route — the currently mounted route component stays mounted. Useful
     * when the same route owns sub-state reflected in the URL (an editor
     * swapping files via tabs, a media player changing tracks). `keepCurrentRoute`
     * is independent of push vs replace: replace (here) when the shallow change
     * shouldn't grow the back stack; `navigate({ keepCurrentRoute })` when it should.
     *
     * Pass `{ state }` to attach user state to the entry (readable via `state`,
     * survives back/forward). Coexists with `keepCurrentRoute`'s internal skip
     * marker.
     */
    replace(
        to: NameToRoute<T> | string,
        options: { keepCurrentRoute?: boolean; state?: Record<string, unknown> } = {},
    ) {
        this.pushOrReplace('replace', to, options);
    }

    getActiveRoute(currentPath: string, _stores: any, pathCounter: number) {
        for (const { pathRe, path, name, component, wrapperComponent, redirect } of this.routes) {
            let result;

            if (pathRe) {
                result = pathRe.exec(currentPath);
            } else {
                result = {
                    groups: {},
                };
            }

            if (result) {
                return {
                    name,
                    component,
                    routeParams: decodeParams(result.groups),
                    path,
                    wrapperComponent,
                    redirect,
                    pathCounter,
                };
            }
        }
        return undefined;
    }
}
