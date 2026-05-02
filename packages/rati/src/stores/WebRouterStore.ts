import { observable, action, computed } from 'mobx';
import type { ComponentType, FC } from 'react';
import { createHistory, type History, type HistoryType, type Location } from '../common/history';
import { interceptNavigations, isNavigationApiAvailable } from '../common/navigationInterceptor';
import {
    installScrollRestoration,
    type ScrollRestorationOptions,
} from '../common/scrollRestoration';
import type { TupleToUnion } from '../types/generic';
import type { CreateView, ViewComponent } from '../common/view';
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

/*
export type ViewComponentForOptionalView<
    TView extends GenericView | undefined,
    TParams extends {}
> = TView extends GenericView
    ? LegacyViewComponent<TView>
    : LegacyViewComponent<EmptyView<TParams>>;


export class EmptyView<Params extends {} = {}> extends View<EmptyView<Params>, Params> {
    data = {};
    stores = {};
}

export function routeLegacy<
    Path extends string,
    Name extends string,
    ViewComponent extends ViewComponentForOptionalView<
        TView,
        { routeParams: ExtractRouteParams<Path> }
    >, // ViewComponentForClass<VS>,
    TView extends GenericView | undefined
>(
    path: Path,
    name: Name,
    component: ViewComponent,
    view?: ViewClassForView<TView, { routeParams: ExtractRouteParams<Path> }, any>, // TODO: improve any type
    wrapperComponent?: ComponentType
) {
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

    const pathRe = path === '*' ? null : new RegExp(pathReString);

    return {
        path,
        pathRe,
        name,
        // Empty view is used here to pass routeParams to the component
        view: view ?? EmptyView,
        component,
        wrapperComponent,
    };
}
*/

// -------------------------------------------------------------

export interface RatiUserTypes {
    // routes: GenericRouteType[];
}

export type UserRoutes = RatiUserTypes extends { routes: infer R } ? R : never;

// -------------------------------------------------------------

export type ViewComponentForOptionalView<
    View extends CreateView<any> | undefined,
    Params extends {},
> = View extends CreateView<any> ? ViewComponent<View> : FC<Params>;

export function route<
    Path extends string,
    Name extends string,
    TViewComponent extends ViewComponentForOptionalView<TView, ExtractRouteParams<Path>>, // ViewComponentForClass<VS>,
    TView extends CreateView<any> | undefined,
>(
    path: Path,
    name: Name,
    component: TViewComponent,
    view?: TView extends CreateView<any> ? TView : undefined,
    wrapperComponent?: ComponentType
) {
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

    const pathRe = path === '*' ? null : new RegExp(pathReString);

    return {
        path,
        pathRe,
        name,
        // Empty view is used here to pass routeParams to the component
        view,
        component,
        wrapperComponent,
    };
}

export type GenericRouteType = {
    name: string;
    path: string;
    pathRe: RegExp | null;
    view: any;
    component: any;
    wrapperComponent?: ComponentType | undefined;
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

type GetView = ReturnType<WebRouterStore<GenericRouteType[]>['getActiveRoute']>;

/** Activated route shape, with an optional hydration-only payload. */
type ActiveRoute = NonNullable<GetView> & {
    /**
     * View props pre-resolved on the server. Present only on the very first
     * `activeRoute` after client-side hydration; subsequent navigations leave
     * this `undefined` and ViewLoader resolves on its own.
     */
    hydratedViewProps?: Record<string, unknown> | undefined;
};

export type NameToRoute<T extends readonly GenericRouteType[]> = TupleToUnion<RoutesType<T>>;

/**
 * Snapshot used to seed a router on the client after server rendering.
 * Mirrors what the server entry serialized into the HTML response — the
 * client passes it back so the first paint reads the same active route
 * and view props as the server, with no async resolution gap.
 */
export interface WebRouterHydratedState {
    path: string;
    search: string;
    hash: string;
    /** `name` of the route definition that was matched on the server. */
    activeRouteName: string;
    routeParams: Record<string, string>;
    /** Resolved view props (output of `resolveView`), if the route had a view. */
    viewProps?: Record<string, unknown> | undefined;
}

export interface WebRouterStoreOptions {
    /**
     * Choose history mode. Defaults to auto-detect: `file:` protocol → `hash`
     * (Electron-friendly), otherwise `browser`. Ignored when {@link history}
     * is provided — the caller has already decided.
     */
    historyType?: HistoryType;
    /**
     * Inject a {@link History} instance instead of letting the store create
     * one. Pair with `createMemoryHistory({ url })` for server rendering or
     * any other host that doesn't have a DOM. When set, `historyType` is
     * ignored. Defaults to `createHistory()` (auto-detected browser/hash).
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
    /**
     * True when `window.navigation` is available and we registered an
     * interceptor for it. Components like `<Link>` use this to skip work the
     * platform now does for us (modifier-key checks, target/download handling,
     * cross-origin checks, etc.).
     */
    readonly hasNavigationApi: boolean;
    /** Normalized basename — empty string when none was configured. */
    readonly basename: string;
    /**
     * Always-resolved sentinel kept for backwards compatibility with server
     * entries that `await` it before reading `activeRoute`. Navigation is now
     * synchronous, so `activeRoute` is populated by the time the constructor
     * returns and awaiting this is a no-op.
     */
    pendingNavigation: Promise<void> = Promise.resolve();
    private readonly historyType: 'browser' | 'hash';
    private uninstallNavigationInterceptor: () => void = () => {};
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
            // Caller-supplied history (e.g. createMemoryHistory for SSR).
            // historyType is unused for routing — it only gates the Navigation
            // API wiring below — so default to 'browser' for that purpose.
            this.history = options.history;
            this.historyType = options.historyType ?? 'browser';
        } else {
            this.historyType =
                options.historyType ??
                (typeof window !== 'undefined' && window.location.protocol === 'file:'
                    ? 'hash'
                    : 'browser');
            this.history = createHistory({ type: this.historyType });
        }
        this.unlistenHistory = this.history.listen(listener);

        // Hash mode bypasses the Navigation API: a click on `<a href="#/foo">`
        // is a same-document hash change, which the API surfaces as
        // `event.hashChange = true` and we deliberately skip. So the per-Link
        // click handler stays the only path in hash mode.
        this.hasNavigationApi = this.historyType === 'browser' && isNavigationApiAvailable();
        if (this.hasNavigationApi) {
            this.uninstallNavigationInterceptor = interceptNavigations(() => {
                // The Navigation API has already updated window.location and
                // window.history.state; broadcast so all listeners (route
                // matching, scroll restoration) see the new entry.
                this.history.notify('PUSH');
            });
        }

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
            view: matched.view,
            wrapperComponent: matched.wrapperComponent,
            path: matched.path,
            routeParams: state.routeParams,
            pathCounter: this.pathCounter,
            hydratedViewProps: state.viewProps,
        };
    }

    dispose() {
        this.unlistenHistory();
        this.uninstallNavigationInterceptor();
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

    // Non-shallow observable breaks view class inside this property
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

        // Search and hash always update so observers see them, even on
        // hash-only or query-only navigations that leave the route unchanged.
        this._search = location.search;
        this._hash = location.hash;

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
    @action.bound navigate(to: NameToRoute<T> | string) {
        const path = typeof to === 'string' ? to : this.getPath(to);
        this.history.push(path);
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
     */
    @action.bound replace(
        to: NameToRoute<T> | string,
        options: { keepCurrentRoute?: boolean } = {}
    ) {
        const path = typeof to === 'string' ? to : this.getPath(to);
        const state = options.keepCurrentRoute
            ? { skip: `${this.pathCounter}/${this.sessionId}` }
            : null;
        this.history.replace(path, state);
    }

    getActiveRoute(currentPath: string, _stores: any, pathCounter: number) {
        for (const { pathRe, path, view, name, component, wrapperComponent } of this.routes) {
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
                    view,
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
