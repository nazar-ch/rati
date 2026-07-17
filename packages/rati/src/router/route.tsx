import type { ComponentType, ReactNode } from 'react';
import type { TupleToUnion } from '../types/generic';
import type { Scope, ScopeComponent, ScopeProvidesOf } from '../scope/scope';
import { createMandala, type MandalaConfig } from '../mandala/mandala';

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
export type RouteContextValueOf<Routes extends readonly GenericRouteType[], Name extends string> =
    Extract<Routes[number], { name: Name }> extends { scope: infer S }
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

/**
 * Where a path's `:param` tokens are: a name runs from `:` to the next `/` or the end,
 * captured alongside that terminator. {@link buildPathRe} compiles these into the
 * matcher's named groups and `RouterStore.getPath` substitutes at the very same
 * boundaries — sharing the pattern is what keeps the two from drifting. Scanning for the
 * `:name` substring instead would let `:id` match inside `:idx`.
 */
export const PARAM_RE = /:(.*?)(\/|$)/g;

function buildPathRe(path: string): RegExp | null {
    // TODO 2023: allow regexps for the path (manually type params in this case)
    const pathReCore = path.replace(PARAM_RE, '(?<$1>[^/]+?)$2');
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

/** A redirect destination: a route reference (`{ name, …params }`) or a literal path. */
export type RedirectTarget = { name: string } & Record<string, string>;

/**
 * A route-level internal redirect. The client router follows it like a `<Navigate>`
 * (history `replace`, no back-stack entry); on the server `prepareRoute` reports it so
 * the response can be a real 30x before anything renders. External URLs don't belong
 * here — redirect those at the HTTP layer.
 *
 * An object target resolves through the route table and keeps the current search and
 * hash (the alias-route expectation); a string target is an absolute path used verbatim —
 * so under a `basename` it must include it (`to: '/admin/b'`, not `to: '/b'`): write what
 * the URL bar should say, which is the same rule `getPath` follows for a string and the
 * only way a target outside the app's own mount point stays expressible. A relative string
 * is refused where the redirect is followed (the router resolves nothing — see
 * `assertAbsolutePathTarget` in `RouterStore`). A function receives the matched params —
 * the legacy-path shape (`/old/:id` → `/new/:id`); the rule reads its return.
 *
 * A target that resolves back to the route declaring it is a redirect loop: it is reported
 * and the route's component renders, rather than being followed (see `RouterStore.setPath`).
 */
export type RouteRedirect<Path extends string = string> = {
    to: string | RedirectTarget | ((params: ExtractRouteParams<Path>) => string | RedirectTarget);
    /** Advisory for the server: respond 301/308 instead of 302/307. */
    permanent?: boolean;
};

export type RouteOptions<TScope extends Scope<any> | undefined, Path extends string = string> = {
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
    /**
     * Route-level wrapper rendered around the component. It is handed the route's
     * element as `children` — always, which is why `children` is required here: a
     * wrapper that ignores them still fits, and one that declares what it receives no
     * longer has to lie to.
     */
    wrapper?: ComponentType<{ children: ReactNode }> | undefined;
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
    /**
     * Declare this route a redirect — see {@link RouteRedirect}. The component never
     * renders on the happy path (pass `() => null`); it shows only if a redirect loop
     * is detected and following stops.
     */
    redirect?: RouteRedirect<Path>;
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
    `input<Base64Uuid>()`, so a branded prop like `pageId: Base64Uuid` is
    accepted by name.
*/
type RouteComponentGuard<Path extends string, TScope extends Scope<any> | undefined, Component> = [
    TScope,
] extends [Scope<any>]
    ? ScopeComponent<TScope>
    : Component extends (props: infer P) => any
      ? [RequiredKeys<P>] extends [keyof ExtractRouteParams<Path>]
          ? unknown
          : MissingRouteParams<Exclude<RequiredKeys<P>, keyof ExtractRouteParams<Path>>>
      : unknown;

/**
 * Fold a scope + component (+ slots) into the route's renderable mandala (labelled `Route`
 * for DevTools / read errors). Shared by `route` and `group`: `route` builds it eagerly
 * from its options; `group` rebuilds it when a group default supplies a `loading`/`error`
 * slot the route itself didn't declare, merging child-over-group.
 */
export function buildRouteComponent(
    component: ComponentType<any>,
    fold: {
        scope: Scope<any>;
        loading?: ComponentType<any> | undefined;
        error?: ComponentType<any> | undefined;
    },
): ComponentType<any> {
    return createMandala(
        {
            scope: fold.scope,
            component,
            loading: fold.loading ?? (() => null),
            ...(fold.error ? { error: fold.error } : {}),
        },
        'Route',
    );
}

/**
 * The inputs `route` folded its mandala from, retained so a wrapping `group` can re-derive
 * the mandala when the group adds a `loading`/`error` slot. Present only on routes that
 * carry a `scope` (a plain route has no mandala to refold). Internal plumbing — callers
 * render the built `component`.
 */
export type RouteFoldInputs = {
    component: ComponentType<any>;
    loading?: ComponentType<any> | undefined;
    error?: ComponentType<any> | undefined;
};

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
 * already a mandala whose props are its scope's inputs, so the path params feed it
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
    options: RouteOptions<TScope, Path> = {},
) {
    const scopeOption = options.scope;

    // A route is a mandala coupled to a location. A supplied scope is folded with the
    // component into a mandala (params arrive from the URL match; the mandala owns
    // loading/error and source attach/detach across navigation). The fold inputs are kept
    // in `foldInputs` so a wrapping `group` can re-fold with its shared slots.
    const routeComponent =
        scopeOption !== undefined
            ? buildRouteComponent(component as ComponentType<any>, {
                  scope: scopeOption as Scope<any>,
                  loading: options.loading as ComponentType<any> | undefined,
                  error: options.error as ComponentType<any> | undefined,
              })
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
        redirect: options.redirect as RouteRedirect | undefined,
        ...(scopeOption !== undefined
            ? {
                  foldInputs: {
                      component: component as ComponentType<any>,
                      loading: options.loading as ComponentType<any> | undefined,
                      error: options.error as ComponentType<any> | undefined,
                  } satisfies RouteFoldInputs,
              }
            : {}),
    };
}

export type GenericRouteType = {
    name: string;
    path: string;
    pathRe: RegExp | null;
    component: any;
    wrapperComponent?: ComponentType<{ children: ReactNode }> | undefined;
    scope?: Scope<any> | undefined;
    redirect?: RouteRedirect | undefined;
    // Retained fold inputs so `group` can re-derive the mandala with shared slots; present
    // only on scope-bearing routes. Read by `group`, not by the router.
    foldInputs?: RouteFoldInputs | undefined;
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

export type NameToRoute<T extends readonly GenericRouteType[]> = TupleToUnion<RoutesType<T>>;
