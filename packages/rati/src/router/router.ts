import type {
    ExtractRouteParams,
    GenericRouteType,
    NameToRoute,
    RatiUserTypes,
    UserRoutes,
} from './route.js';

/*
    The public face of the router. `Router` is table-blind: navigation targets and the
    active route are typed off the app's one `declare module 'rati'` augmentation
    (`RatiUserTypes['routes']` — the same source `Link`'s `to` reads), never off a route
    table imported as a value. That is what lets a store container hold `router: Router`
    without its type embedding the route components — the inference cycle
    (stores → routes → components → stores) cannot form, because none of these types
    mention a component. See docs/research/stores-and-router.md.

    The implementation behind it is `RouterStore` (./store.ts), which `createRouter`
    constructs and rati's own internals (`RouterOutlet`, `Link`, SSR) narrow back to.
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
 * The augmented table read by *indexed access*, not through `UserRoutes` — that alias
 * `infer`s the table out of a conditional, and a type built by conditioning on it again
 * stays deferred: `name` and `routeParams` read as the right unions, but the discriminant
 * narrows nothing (FND-06). The `keyof … & 'routes'` intersection is what keeps the index
 * legal inside the package, where the interface has no `routes` member yet — it resolves
 * to `never` there, and to `'routes'` under any augmentation.
 */
type UserRouteTable = RatiUserTypes[keyof RatiUserTypes & 'routes'];

/**
 * The current route, typed off the `RatiUserTypes` augmentation — a union discriminated
 * by `name` when the app has one (`activeRoute.name === 'x'` narrows `routeParams`), the
 * generic shape when it doesn't. One conditional only: `ActiveRouteOf` is applied to the
 * indexed table directly (`never` satisfies its constraint in the unaugmented package) —
 * a second `extends` guard around it re-defers the result and kills the narrowing.
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
 * The app's router — what {@link createRouter} returns, `<RouterProvider>` provides, and
 * `useRouter()` hands back. Navigation targets (`{ name, …params }`) and `activeRoute`
 * are typed from the `RatiUserTypes` augmentation, so this type never references the
 * route table as a value — safe to hold anywhere (a store container included) without
 * importing the routes module.
 *
 * Reactivity: a `subscribe`/`getSnapshot` pair (`useSyncExternalStore`-shaped).
 * Components that reach the router through `useRouter()` are subscribed automatically;
 * non-React consumers (a store reacting to navigation) use `subscribe` directly.
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
     * Traverse the history stack by `delta` entries — the back/forward buttons,
     * programmatically. A thin pass-through to the history: the update lands as a POP and
     * resolves the route it restores. Out of range does nothing (the browser's rule). Note
     * the timing difference between hosts: the browser's traversal is asynchronous (the
     * update arrives on a later task), a memory history's is synchronous — code that must
     * work on both subscribes rather than reading the location on the next line.
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
