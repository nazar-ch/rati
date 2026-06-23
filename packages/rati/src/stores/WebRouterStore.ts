import { observable, action, computed } from 'mobx';
import type { ComponentType } from 'react';
import { createBrowserHistory, type History, type Location } from '../common/history';
import {
    installScrollRestoration,
    type ScrollRestorationOptions,
} from '../common/scrollRestoration';
import type { TupleToUnion } from '../types/generic';
import type { Scope, ScopeComponent, ScopeProvidesOf } from '../common/scope';
import { createMandala, type MandalaConfig } from '../mandala/mandala';
import { GlobalStore } from '../stores/GlobalStore';
// import { TupleToUnion } from 'type-fest';

//--------------------------------------------

// Sources:
// https://twitter.com/danvdk/status/1301707026507198464
// https://ja.nsommer.dk/articles/type-checked-url-router.html#d (with validation)

export type ExtractRouteParams<T extends string> = string extends T
    ? // This matches `string` type instead of string literals. It's not
      // possible to get the type for this case, return something generic
      Record<string, string>
    : T extends `${infer _Start}:${infer Param}/${infer Rest}`
      ? { [k in Param | keyof ExtractRouteParams<Rest>]: string }
      : T extends `${infer _Start}:${infer Param}`
        ? { [k in Param]: string }
        : {};

// -------------------------------------------------------------

export interface RatiUserTypes {
    // routes: GenericRouteType[];
}

export type UserRoutes = RatiUserTypes extends { routes: infer R } ? R : never;

/**
 * The context value the route registered under `Name` provides, read off the routes
 * tuple by the route's `scope` (its `.provide()` value, else its resolved props). The
 * context type comes from the route definitions themselves — the same
 * `RatiUserTypes['routes']` source `Link`'s `to` reads, no separate registration.
 * `unknown` when that route has no scope (so no context to read). This is what
 * `useRouteContext(name)` returns.
 */
export type RouteContextValueOf<
    Routes extends readonly GenericRouteType[],
    Name extends string,
> = Extract<Routes[number], { name: Name }> extends { scope: infer S }
    ? S extends Scope<any>
        ? ScopeProvidesOf<S>
        : unknown
    : unknown;

/**
 * Names of the routes that carry a context (the scope-bearing ones) — the valid
 * arguments to {@link useRouteContext}. Routes without a scope (`scope: undefined`) are
 * filtered out.
 */
export type RouteContextNames<Routes extends readonly GenericRouteType[]> = {
    [K in keyof Routes]: Routes[K] extends { scope: infer S }
        ? S extends Scope<any>
            ? Routes[K]['name']
            : never
        : never;
}[number];

// -------------------------------------------------------------

function buildPathRe(path: string): RegExp | null {
    // TODO 2023: allow regexps for the path (manually type params in this case)
    const pathReCore = path.replace(/:(.*?)(\/|$)/g, '(?<$1>[^/]+?)$2');
    const pathReString =
        '^' +
        pathReCore +
        (pathReCore.endsWith('/')
            ? '$'
            : // Optional slash in the end (match /path & /path/)
              // TODO 2023: use redirects for this case
              '/{0,1}$');

    return path === '*' ? null : new RegExp(pathReString);
}

export type RouteOptions<TScope extends Scope<any> | undefined> = {
    /**
     * Data the route resolves before the component renders. When present, `route`
     * folds it together with the component into a mandala (see below), so resolution
     * runs on the source-based mandala engine — loading/error slots, attach-on-build /
     * detach-on-navigate, SSR via Suspense (and promise dehydration). The component
     * receives the resolved props.
     *
     * A scope value, exactly like `island`'s `scope` — a load reads its own deps via
     * `hook(() => use(SomeContext))`, so there's no env to thread.
     */
    scope?: TScope extends Scope<any> ? TScope : undefined;
    /** Route-level wrapper rendered around the component. */
    wrapper?: ComponentType | undefined;
    /**
     * Slot shown while the scope resolves — the mandala's `loading`. Defaults to
     * rendering nothing. Only meaningful alongside `scope`.
     */
    loading?: TScope extends Scope<any> ? MandalaConfig<TScope>['loading'] : undefined;
    /**
     * Slot shown on resolution failure — the mandala's `error` (switch on `error.code`).
     * When omitted, the error throws to the nearest ErrorBoundary. Only meaningful
     * alongside `scope`.
     */
    error?: TScope extends Scope<any> ? MandalaConfig<TScope>['error'] : undefined;
};

// The required (non-optional) keys of an object type.
type RequiredKeys<T> = {
    [K in keyof T]-?: {} extends Pick<T, K> ? never : K;
}[keyof T];

// Surfaced when a route component requires props the path can't supply.
type MissingRouteParams<Missing extends PropertyKey> = {
    'route: component needs props not present in the path': Missing;
};

/*
    Validates the (inferred) route component, intersected onto its type so the
    argument must satisfy it. With a `scope`, the component is checked against the
    scope. Otherwise it's checked by param *name*: its required props must all be
    path params. Values are intentionally not pinned to the path's plain `string`
    — a component (typically an island) brands a URL segment via
    `prop<Base64Uuid>()`, so a branded prop like `pageId: Base64Uuid` is
    accepted by name.
*/
type RouteComponentGuard<
    Path extends string,
    TScope extends Scope<any> | undefined,
    Component,
> = [TScope] extends [Scope<any>]
    ? ScopeComponent<TScope>
    : Component extends (props: infer P) => any
      ? [RequiredKeys<P>] extends [keyof ExtractRouteParams<Path>]
          ? unknown
          : MissingRouteParams<Exclude<RequiredKeys<P>, keyof ExtractRouteParams<Path>>>
      : unknown;

/**
 * The URL-bound sibling of `island`: both build a mandala (rati's core renderable unit
 * — a scope bound to a component with loading/error), `route` specialized to a location.
 * Its data inputs (`scope`, `loading`, `error`) are the mandala's and behave identically;
 * a route adds the route bits (path, name, wrapper) and feeds the path-matched params in
 * as the mandala's props.
 *
 * When `options.scope` is given, the component + scope (+ `loading`, `error`) are folded
 * into a mandala and stored as the route's component, so resolution goes through the
 * source-based mandala engine — the Router renders that component directly, handing it the
 * route params. So a route declares its data inline, no separate `island` module needed:
 *
 *     route('/spaces/:spaceId/pages/:pageId', 'page', PageBody, {
 *         scope: pageScope,
 *         loading: PageLoading,
 *         error: PageError,
 *     })
 *
 * A component built with `island` up front also works as-is with no `scope` — it is
 * already a mandala whose props are its scope's params, so the path params feed it
 * directly: `route('/spaces/:spaceId/pages/:pageId', 'page', PageIsland)`. A plain
 * component with no `scope` is rendered directly with the route params.
 */
export function route<
    Path extends string,
    Name extends string,
    Component extends ComponentType<any>,
    TScope extends Scope<any> | undefined = undefined,
>(
    path: Path,
    name: Name,
    component: Component & RouteComponentGuard<Path, TScope, Component>,
    options: RouteOptions<TScope> = {}
) {
    const scopeOption = options.scope;

    // A route is a mandala coupled to a location. A supplied scope is folded with the
    // component into a mandala here (labelled `Route` for DevTools / read errors); params
    // arrive from the URL match (the Router renders it with the route params), and the
    // mandala owns loading/error and source attach/detach across navigation.
    const routeComponent =
        scopeOption !== undefined
            ? createMandala(
                  {
                      scope: scopeOption as Scope<any>,
                      component: component as ComponentType<any>,
                      loading: options.loading ?? (() => null),
                      ...(options.error ? { error: options.error } : {}),
                  },
                  'Route'
              )
            : component;

    return {
        path,
        pathRe: buildPathRe(path),
        name,
        component: routeComponent,
        wrapperComponent: options.wrapper,
        // The scope the route's mandala was built from (undefined for a plain route).
        // useRouteContext(name) resolves the provided value through this scope, and the
        // route-context types are derived from this field's type — so the context type
        // comes straight from the route definition.
        scope: scopeOption as TScope extends Scope<any> ? TScope : undefined,
    };
}

export type GenericRouteType = {
    name: string;
    path: string;
    pathRe: RegExp | null;
    component: any;
    wrapperComponent?: ComponentType | undefined;
    scope?: Scope<any> | undefined;
};

type RoutesType<
    T extends
        | { name: string; path: string }[]
        | readonly { readonly name: string; readonly path: string }[],
> = {
    [K in keyof T]: {
        name: T[K]['name'];
    } & ExtractRouteParams<T[K]['path']>;
};

type GetActiveRoute = ReturnType<WebRouterStore<GenericRouteType[]>['getActiveRoute']>;

/** Activated route shape. */
type ActiveRoute = NonNullable<GetActiveRoute>;

export type NameToRoute<T extends readonly GenericRouteType[]> = TupleToUnion<RoutesType<T>>;

/**
 * Snapshot used to seed a router on the client after server rendering. Mirrors
 * what the server entry serialized into the HTML response — the client passes it
 * back so the first paint reads the same active route as the server. This is the
 * *routing* snapshot only; a route's resolved scope data is dehydrated separately
 * by the mandala engine (see `IslandHydrationProvider`).
 */
export interface WebRouterHydratedState {
    path: string;
    search: string;
    hash: string;
    /** `name` of the route definition that was matched on the server. */
    activeRouteName: string;
    routeParams: Record<string, string>;
}

export interface WebRouterStoreOptions {
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
    hydratedState?: WebRouterHydratedState | undefined;
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

export class WebRouterStore<
    T extends readonly GenericRouteType[] = readonly GenericRouteType[],
> extends GlobalStore<any> {
    history: History;

    unlistenHistory: () => void;
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

    constructor(
        stores: any,
        public routes: T,
        options: WebRouterStoreOptions = {}
    ) {
        super(stores);

        this.basename = normalizeBasename(options.basename);

        const listener = ({ location }: { location: Location }) => {
            this.setPath(location);
        };

        if (options.history) {
            this.history = options.history;
        } else {
            this.history = createBrowserHistory();
        }
        this.unlistenHistory = this.history.listen(listener);

        if (options.scrollRestoration !== false) {
            this.uninstallScrollRestoration = installScrollRestoration(
                this.history,
                options.scrollRestoration ?? {}
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

    @action.bound private seedFromHydratedState(state: WebRouterHydratedState) {
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
            pathCounter: this.pathCounter,
        };
    }

    dispose() {
        this.unlistenHistory();
        this.uninstallScrollRestoration();
    }

    getPath(args: NameToRoute<T> | string) {
        if (typeof args === 'string') {
            // String paths are passed through verbatim (basename is the caller's
            // responsibility here — they may already have the full URL).
            return args;
        }

        const { name, ...params } = args;
        let path: string = this.routes.find((item) => item.name === name)!.path;
        if (params) {
            for (const [key, value] of Object.entries(params)) {
                path = path.replace(`:${key}`, value as string);
            }
        }
        return this.basename + path;
    }

    @computed get path() {
        return this._path;
    }

    /** The raw `?…` portion of the current URL, including the leading `?`. */
    @computed get search() {
        return this._search;
    }

    /**
     * Parsed query string. The returned object is a fresh `URLSearchParams`
     * each time the underlying search changes — treat it as immutable. To
     * change params, use {@link setSearchParams}.
     */
    @computed get searchParams() {
        return new URLSearchParams(this._search);
    }

    /** The `#…` portion of the current URL, including the leading `#`. */
    @computed get hash() {
        return this._hash;
    }

    /**
     * User state attached to the current history entry via `navigate`/`replace`
     * `{ state }`, or `null`. The browser persists it per entry, so it survives
     * back/forward. Use it to carry UI-local context that shouldn't live in the
     * URL itself — e.g. which panel a navigation targets.
     */
    @computed get state(): unknown {
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

    @observable private accessor _path: string = '';
    @observable private accessor _search: string = '';
    @observable private accessor _hash: string = '';
    @observable.ref private accessor _state: unknown = null;

    // Non-shallow observable breaks the component class inside this property
    @observable.shallow accessor activeRoute: ActiveRoute | null = null;

    private pathCounter: number = 0;
    private readonly sessionId = globalThis.crypto?.randomUUID
        ? globalThis.crypto.randomUUID()
        : // for local development, and Node < 19 where globalThis.crypto is absent
          `${Math.random()}-${Math.random()}`;
    @action.bound setPath(location: Location) {
        const { state } = location;
        const pathname = stripBasename(location.pathname, this.basename);
        const currentPathCounter = this.pathCounter++;

        // Search, hash and state always update so observers see them, even on
        // hash-only or query-only navigations (or skipped shallow replaces) that
        // leave the route unchanged.
        this._search = location.search;
        this._hash = location.hash;
        this._state = state ?? null;

        // Skip resolution only when the URL didn't change AND we already have
        // a resolved route. Otherwise we'd skip on the initial mount race or
        // on StrictMode re-fires where _path was set but activeRoute wasn't
        // yet committed.
        if (this._path === pathname && this.activeRoute) {
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

        this.activeRoute =
            this.getActiveRoute(
                this.path,
                this.stores as any,
                // Using this number as `key` ensures that the route that was not
                // skipped above will be rerendered
                this.pathCounter
            ) ?? null;
    }

    /**
     * Update the query string on the current URL. Defaults to `replace` so
     * tweaking filters/pagination doesn't grow the back stack; pass
     * `{ mode: 'push' }` to add a history entry instead.
     *
     * Accepts anything `URLSearchParams` accepts (object, string, entries).
     */
    @action.bound setSearchParams(
        init: ConstructorParameters<typeof URLSearchParams>[0] | URLSearchParams,
        options: { mode?: 'push' | 'replace' } = {}
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
     * Navigate to `to` by pushing a new history entry. The route re-resolves
     * and re-renders; browser back returns to the previous URL.
     *
     * Use for ordinary user-initiated navigation. `<Link>` calls this under
     * the hood. For programmatic redirects where the previous URL must not be
     * reachable via back (post-login, auth-gate, canonicalization), use
     * `replace()`.
     */
    @action.bound navigate(
        to: NameToRoute<T> | string,
        options: { state?: Record<string, unknown> } = {}
    ) {
        const path = typeof to === 'string' ? to : this.getPath(to);
        this.history.push(path, options.state ?? null);
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
     * swapping files via tabs, a media player changing tracks). Always pairs
     * with replace semantics by design — a "shallow" change isn't a real
     * navigation, so it shouldn't grow the back stack either.
     *
     * Pass `{ state }` to attach user state to the entry (readable via `state`,
     * survives back/forward). Coexists with `keepCurrentRoute`'s internal skip
     * marker.
     */
    @action.bound replace(
        to: NameToRoute<T> | string,
        options: { keepCurrentRoute?: boolean; state?: Record<string, unknown> } = {}
    ) {
        const path = typeof to === 'string' ? to : this.getPath(to);
        const skip = options.keepCurrentRoute
            ? { skip: `${this.pathCounter}/${this.sessionId}` }
            : undefined;
        const state = skip || options.state ? { ...skip, ...options.state } : null;
        this.history.replace(path, state);
    }

    getActiveRoute(currentPath: string, _stores: any, pathCounter: number) {
        for (const { pathRe, path, name, component, wrapperComponent } of this.routes) {
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
                    routeParams: (result.groups as any) ?? {},
                    path,
                    wrapperComponent,
                    pathCounter,
                };
            }
        }
        return undefined;
    }
}
