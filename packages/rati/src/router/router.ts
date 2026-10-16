import type {
    ExtractRouteParams,
    GenericRouteType,
    NameToRoute,
    RatiUserTypes,
    UserRoutes,
} from './route.js';

/*
    The public face of the router: `Router` is table-blind, typed off the app's
    `RatiUserTypes['routes']` augmentation and never a route table imported as a value, so a
    store container holds it with no stores → routes → components cycle. `RouterStore`
    (./store.ts) implements it.
*/

/**
 * The active route of one concrete route table, as a name-discriminated union —
 * `activeRoute.name === 'page'` narrows `routeParams` to that route's params. This is
 * the table-parameterized building block; {@link ActiveRoute} is the augmentation-typed
 * version the {@link Router} surface exposes.
 */
export type ActiveRouteOf<T extends readonly GenericRouteType[]> = {
    [K in keyof T]: {
        name: T[K]['name'];
        path: T[K]['path'];
        routeParams: ExtractRouteParams<T[K]['path']>;
    };
}[number];

/**
 * What no augmentation gets: the same shape, untyped. Also the shape rati's own code
 * sees (the framework never knows the app's table).
 */
type GenericActiveRoute = {
    name: string;
    path: string;
    routeParams: Record<string, string>;
};

/**
 * The augmented table read by indexed access, never through `UserRoutes`: a type conditioned
 * on that alias's `infer` stays deferred, and its discriminant narrows nothing. The
 * `keyof … & 'routes'` intersection keeps the index legal in the package, resolving to
 * `never` there.
 */
type UserRouteTable = RatiUserTypes[keyof RatiUserTypes & 'routes'];

/**
 * The current route off the `RatiUserTypes` augmentation — a union discriminated by `name`
 * when the app has one, the generic shape when not. One conditional only: a second
 * `extends` guard re-defers the result and kills the narrowing.
 */
export type ActiveRoute = [UserRoutes] extends [never]
    ? GenericActiveRoute
    : ActiveRouteOf<UserRouteTable>;

/** Options for {@link Router.navigate} / {@link Router.replace}. */
export interface NavigateOptions {
    /**
     * Shallow navigation: change the URL (and the back stack, for `navigate`) but keep
     * the currently mounted route component in place — no re-resolve, no remount.
     */
    keepCurrentRoute?: boolean;
    /**
     * User state attached to the history entry (readable via {@link Router.state},
     * survives back/forward).
     */
    state?: Record<string, unknown>;
}

/**
 * The app's router — what {@link createRouter} returns and `useRouter()` hands back. Typed
 * off the `RatiUserTypes` augmentation, never the route table, so any container can hold
 * it. A `subscribe`/`getSnapshot` pair: `useRouter()` subscribes a component, and a
 * non-React consumer calls `subscribe`.
 */
export interface Router {
    /** The resolved current route, or `null` before the first match / when nothing matches. */
    readonly activeRoute: ActiveRoute | null;
    /** Current pathname (basename stripped). */
    readonly path: string;
    /** The raw `?…` portion of the current URL, including the leading `?`. */
    readonly search: string;
    /** The `#…` portion of the current URL, including the leading `#`. */
    readonly hash: string;
    /** Parsed query string — a fresh `URLSearchParams` per read; treat as immutable. */
    readonly searchParams: URLSearchParams;
    /** User state attached to the current history entry, or `null`. */
    readonly state: unknown;
    /** Push a new history entry and resolve the matching route. */
    navigate(to: NameToRoute<UserRoutes> | string, options?: NavigateOptions): void;
    /** Replace the current history entry and resolve the matching route. */
    replace(to: NameToRoute<UserRoutes> | string, options?: NavigateOptions): void;
    /** Build the URL path for a route reference (or pass a string through verbatim). */
    getPath(to: NameToRoute<UserRoutes> | string): string;
    /**
     * Traverses the history stack by `delta` entries, landing as a POP; out of range does
     * nothing. The browser traverses asynchronously and a memory history synchronously, so
     * code for both subscribes rather than reading the location on the next line.
     */
    go(delta: number): void;
    /** `go(-1)` — "close this and go back". */
    back(): void;
    /** `go(1)`. */
    forward(): void;
    /** Update the query string in place (`replace` by default; `{ mode: 'push' }` to stack). */
    setSearchParams(
        init: ConstructorParameters<typeof URLSearchParams>[0] | URLSearchParams,
        options?: { mode?: 'push' | 'replace' },
    ): void;
    /** Whether `path` (a `getPath`-style URL path) names the current route. */
    isPath(path: string): boolean;
    /** Begin loading the chunk of the `lazy()` route matching `path`, without navigating. */
    preloadRoute(path: string): Promise<unknown> | undefined;
    /** Subscribe to navigation changes; returns the unsubscriber. */
    subscribe(onChange: () => void): () => void;
    /** Version counter for `useSyncExternalStore` — bumps on every navigation. */
    getSnapshot(): number;
    /**
     * Detach from the history. An app-lifetime router never needs this; a per-request
     * router (SSR) or a per-test one does.
     */
    dispose(): void;
}
