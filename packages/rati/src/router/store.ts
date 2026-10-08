import type { ComponentType, ReactNode } from 'react';

import { createBrowserHistory, type History, type Location } from './history.js';
import { PARAM_RE, type GenericRouteType, type NameToRoute, type RouteRedirect } from './route.js';
import type { ActiveRouteOf, NavigateOptions, Router } from './router.js';
import { installScrollRestoration, type ScrollRestorationOptions } from './scrollRestoration.js';

import { navTrace } from '../util/navTrace.js';

// Redirect chains longer than this are treated as a cycle (see setPath).
const MAX_REDIRECT_DEPTH = 10;

/**
 * What rendering the matched route needs beyond the public `activeRoute` shape
 * (`RouterOutlet` reads these off the concrete store; the `Router` interface exposes
 * only name/path/params, so containers holding it never see a component type).
 */
type RouteRenderFields = {
    component: any;
    wrapperComponent?: ComponentType<{ children: ReactNode }> | undefined;
    redirect?: RouteRedirect | undefined;
    pathCounter: number;
};

/** Activated route shape: the public discriminated part plus the render internals. */
type StoreActiveRoute<T extends readonly GenericRouteType[]> = ActiveRouteOf<T> & RouteRenderFields;

/**
 * What rati's router-consuming seams accept: the public augmentation-typed face, or the
 * concrete store (rati's own tests hold one; an app normally never sees it).
 */
export type AnyRouter = Router | RouterStore;

/**
 * Narrow the public {@link Router} back to the implementation. Everything rati hands
 * out is one (`createRouter` constructs it); the throw catches a hand-rolled object at
 * the seam where it was passed in, instead of as a property crash later.
 */
export function toRouterStore(router: AnyRouter): RouterStore {
    if (!(router instanceof RouterStore)) {
        throw new Error('[rati] expected a router built by createRouter().');
    }
    return router;
}

/**
 * The routing snapshot seeding a client router after a server render, so the first paint
 * reads the server's active route. A route's resolved scope data is dehydrated separately
 * (`HydrationProvider` in `rati/ssr`).
 */
export interface RouterHydratedState {
    path: string;
    search: string;
    hash: string;
    /** `name` of the route definition that was matched on the server. */
    activeRouteName: string;
    routeParams: Record<string, string>;
}

export interface RouterOptions {
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
 * long:1
 * The router's string vocabulary is absolute path references; anything else is refused here,
 * at the choke point. A relative string resolves against the current URL in the browser and
 * against a placeholder origin in memory history, so the two hosts disagree; `<Link>` or an
 * anchor is the surface that owns a relative reference.
 *
 * A leading `/` is not yet a path: the URL parser reads `//host`, and every spelling it
 * normalizes into one (`/\host`, tab-smuggled variants), as another origin. A redirect target
 * travels verbatim into the server's `Location` header, where that is an open redirect, so
 * the check resolves against the placeholder origin and refuses anything that leaves it.
 */
function assertAbsolutePathTarget(target: string, where: string): void {
    if (!target.startsWith('/')) {
        throw new Error(
            `[rati] ${where}: "${target}" is not an absolute path. Router-facing strings must ` +
                `start with "/" — the router does not resolve a reference against the current URL. ` +
                `Name a route ({ name: … }, or getPath) to have the table build the path, use ` +
                `setSearchParams() to change the query, or put the reference on a <Link>/an anchor, ` +
                `where the platform resolves it.`,
        );
    }
    let origin: string | null = null;
    try {
        origin = new URL(target, PLACEHOLDER_ORIGIN).origin;
    } catch {
        // e.g. "//[" — unparseable; neither history could follow it either.
    }
    if (origin !== PLACEHOLDER_ORIGIN) {
        throw new Error(
            `[rati] ${where}: "${target}" resolves off the app's origin ("//host" is an ` +
                `authority, not a path) — the router only moves within the app. Link an ` +
                `external URL with a plain <a>; redirect to one at the HTTP layer.`,
        );
    }
}

// The memory history's trick (see createMemoryHistory): a fixed origin so the URL parser
// answers for path-only input. Any input that resolves away from it named another origin.
const PLACEHOLDER_ORIGIN = 'http://_';

/**
 * Percent-decodes the matched params, the inbound half of `getPath`'s round trip. A sequence
 * `decodeURIComponent` rejects (`/pages/%zz`) hands the raw segment through and is reported:
 * a throw during `setPath` turns a bad address into a dead app.
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
 * Shallow value-equality for per-entry history `state`, deciding whether a same-URL
 * navigation re-resolves ({@link RouterStore.setPath}). Never reference equality: POP and
 * StrictMode both re-read `state` into a fresh object. Shallow fits flat UI-local context.
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

export class RouterStore<T extends readonly GenericRouteType[] = readonly GenericRouteType[]> {
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
     * Always resolved: navigation is synchronous, so `activeRoute` is set when the constructor
     * returns. Kept for server entries that `await` it.
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
        public routes: T,
        options: RouterOptions = {},
    ) {
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
            // Server-rendered snapshot: seeded so the first client render matches the server
            // HTML. The route is already resolved.
            this.seedFromHydratedState(options.hydratedState);
        } else {
            this.setPath(this.history.location);
        }
    }

    private seedFromHydratedState(state: RouterHydratedState) {
        const matched = this.routes.find((r) => r.name === state.activeRouteName);
        if (!matched) {
            // The hydrated route name is missing from this client's table (the routes
            // drifted): run the matcher against the URL. `_path` stays unseeded, so setPath's
            // same-path early return cannot skip the resolve.
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
        } as StoreActiveRoute<T>;
        this.emitChange();
    }

    dispose() {
        this.unlistenHistory();
        this.uninstallScrollRestoration();
        // Unlistening only detaches THIS store; the history it created is still
        // holding the window's popstate. Nobody else can let go of it.
        if (this.ownsHistory) this.history.dispose?.();
    }

    getPath(args: NameToRoute<T> | string) {
        if (typeof args === 'string') {
            // String paths pass through verbatim, basename included, and exempt from the
            // absolute-path rule: this output feeds `href` attributes, where the platform
            // resolves a relative reference (Link's anchorPath).
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
        // Substitutes at the path's own `:param` boundaries (PARAM_RE), so a name is never
        // found inside a longer one; values are percent-encoded, the outbound half of the
        // round trip. A value of exactly '.' or '..' is a path operator the URL parser
        // resolves away, `%2E` included, so getPath refuses it.
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
     * User state attached to the current history entry by `navigate`/`replace` `{ state }`,
     * or `null`, persisted per entry across back/forward. A navigation changing only `state`
     * still re-resolves the active route.
     */
    get state(): unknown {
        return this._state;
    }

    /** See {@link Router.go} — forwarded, not the whole history: `listen`/`replace` stay in. */
    go(delta: number): void {
        this.history.go(delta);
    }

    back(): void {
        this.history.back();
    }

    forward(): void {
        this.history.forward();
    }

    isPath(path: string) {
        // `path` here is a URL path (the value returned by getPath, used in href
        // attributes), so strip the basename before comparing against the
        // route-internal `path`.
        return stripBasename(path, this.basename) === this.path;
    }

    /**
     * Begins loading the chunk for the route matching `path`, without navigating — what
     * `<Link prefetch>` calls on hover. A no-op unless the route's component is a
     * preload-capable {@link lazy}; the factory dedupes repeats.
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

    activeRoute: StoreActiveRoute<T> | null = null;

    /**
     * The route-level redirects the CURRENT navigation followed, oldest first —
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

            // Skip resolution only when the URL is unchanged, the entry state is equal AND a
            // route is resolved; the path/route guard covers the mount race and StrictMode
            // re-fires. A state-only change re-resolves, so stepping between two entries
            // sharing a URL re-keys the route.
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
                    // Using this number as `key` ensures that the route that was not
                    // skipped above will be rerendered
                    this.pathCounter,
                ) ?? null;

            // A route-level redirect is followed before the route renders: record the hop
            // (prepareRoute's 30x input) and `replace`, whose synchronous listener resolves the
            // target in this frame. The depth guard breaks a cycle by rendering the last route.
            if (matched?.redirect && this.redirectDepth < MAX_REDIRECT_DEPTH) {
                const { to, permanent = false } = matched.redirect;
                const target = typeof to === 'function' ? to(matched.routeParams) : to;
                let targetPath: string;
                if (typeof target === 'string') {
                    // Refused before the hop is recorded: the 1-cycle check below compares
                    // resolved pathnames and reads a relative spelling as different.
                    assertAbsolutePathTarget(target, `redirect from route "${matched.name}"`);
                    targetPath = target;
                } else {
                    targetPath = this.getPath(target as NameToRoute<T>) + this._search + this._hash;
                }
                this.redirectHops.push({ from: pathname, to: targetPath, permanent });
                // A target pointing back at the pathname being resolved is a 1-cycle the nested
                // setPath cannot see — its same-path early return leaves the PREVIOUS route at
                // the new URL — so it falls through to the loop report. Search and hash stay
                // out of the comparison: a query-only difference is the same trap.
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
        options: NavigateOptions,
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
     * Pushes a history entry and re-resolves the route; back returns to the previous URL. For
     * a redirect whose previous URL must not stay reachable, use `replace()`.
     * `{ keepCurrentRoute: true }` is a shallow push: the URL and back stack change, and the
     * mounted route stays.
     */
    navigate(to: NameToRoute<T> | string, options: NavigateOptions = {}) {
        this.pushOrReplace('push', to, options);
    }

    /**
     * Replaces the current history entry and re-resolves the route; back skips the previous
     * URL — post-login redirects, auth-gate bounces, canonicalization.
     * `{ keepCurrentRoute: true }` updates the URL without re-resolving, for sub-state the
     * mounted route owns.
     */
    replace(to: NameToRoute<T> | string, options: NavigateOptions = {}) {
        this.pushOrReplace('replace', to, options);
    }

    getActiveRoute(currentPath: string, pathCounter: number): StoreActiveRoute<T> | undefined {
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
                } as StoreActiveRoute<T>;
            }
        }
        return undefined;
    }
}
