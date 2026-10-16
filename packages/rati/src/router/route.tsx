import type { ComponentType, ReactNode } from 'react';

import { createMandala, type MandalaConfig } from '../mandala/mandala.js';
import type { RetryOption } from '../mandala/retryPolicy.js';
import type { Scope, ScopeComponent, ScopeProvidesOf } from '../scope/scope.js';
import type { TupleToUnion } from '../types/generic.js';

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

export interface RatiUserTypes {
    // An app augments `routes: typeof routes` here.
}

export type UserRoutes = RatiUserTypes extends { routes: infer R } ? R : never;

/**
 * The context value the route registered under `Name` provides, read off the routes tuple
 * by its `scope` — the `.provide()` value, else its resolved props; `unknown` for a route
 * without one. What `useRouteContext(name)` returns, with no separate registration.
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

/**
 * Where a path's `:param` tokens are: a name runs from `:` to the next `/` or the end,
 * captured with that terminator. {@link buildPathRe} and `RouterStore.getPath` share it, so
 * the two never drift, and `:id` never matches inside `:idx`.
 */
export const PARAM_RE = /:(.*?)(\/|$)/g;

function buildPathRe(path: string): RegExp | null {
    const pathReCore = path.replace(PARAM_RE, '(?<$1>[^/]+?)$2');
    const pathReString =
        '^' +
        pathReCore +
        (pathReCore.endsWith('/')
            ? '$'
            : // Optional slash in the end (match /path & /path/)
              '/{0,1}$');

    return path === '*' ? null : new RegExp(pathReString);
}

/** A redirect destination: a route reference (`{ name, …params }`) or a literal path. */
export type RedirectTarget = { name: string } & Record<string, string>;

/**
 * A route-level internal redirect: the client `replace`s, and `prepareRoute` reports a
 * server 30x before anything renders. An object target resolves through the route table,
 * keeping search and hash; a string is an absolute path, basename included; a function
 * receives the matched params.
 */
export type RouteRedirect<Path extends string = string> = {
    to: string | RedirectTarget | ((params: ExtractRouteParams<Path>) => string | RedirectTarget);
    /** Advisory for the server: respond 301/308 instead of 302/307. */
    permanent?: boolean;
};

export type RouteOptions<TScope extends Scope<any> | undefined, Path extends string = string> = {
    /**
     * Data the route resolves before the component renders, the same scope value `island`
     * takes; `route` folds it with the component into a mandala, and the component receives
     * the resolved props.
     */
    scope?: TScope extends Scope<any> ? TScope : undefined;
    /**
     * Route-level wrapper rendered around the component, handed the route's element as
     * `children` — always, which is why `children` is required.
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
     * Resolve this route's scope during a server render? Default `true`; `false` ships the
     * `loading` slot and resolves after hydration — the mandala's `ssr` (see `island`). Only
     * meaningful alongside `scope`.
     */
    ssr?: TScope extends Scope<any> ? boolean : undefined;
    /**
     * Keep the previous page's content on screen while a param change re-resolves, instead
     * of blanking to the `loading` slot — the mandala's `keepStale` (see `island`). Read
     * `useScopeControls(scope).isStale` in the subtree to mark it. Only meaningful
     * alongside `scope`.
     */
    keepStale?: TScope extends Scope<any> ? boolean : undefined;
    /**
     * Hold the `loading` slot back for this many milliseconds, so a fast resolution never
     * flashes it — the mandala's `loadingDelayMs` (see `island`). Only meaningful alongside
     * `scope`.
     */
    loadingDelayMs?: TScope extends Scope<any> ? number : undefined;
    /**
     * The automatic retry policy, the mandala's `retry` (see `island`): on by default for a
     * failure classified `retryable: true`; `{ count, backoffMs? }` asks for more, `false`
     * opts out. Only meaningful alongside `scope`.
     */
    retry?: TScope extends Scope<any> ? MandalaConfig<TScope>['retry'] : undefined;
    /**
     * What a server render does with a failed load: `'retry'` (default) ships the `loading`
     * slot, `'dehydrate'` the `error` slot — the mandala's `ssrErrors` (see `island`). Only
     * meaningful alongside `scope`.
     */
    ssrErrors?: TScope extends Scope<any> ? MandalaConfig<TScope>['ssrErrors'] : undefined;
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
    Validates the inferred route component, intersected onto its type: against the scope
    when there is one, else by param NAME — its required props must all be path params.
    Values stay unpinned, so a branded prop (`pageId: Base64Uuid`) is accepted.
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
 * Folds a scope, component and slots into the route's mandala, labelled `Route`. `route`
 * builds it eagerly; `group` rebuilds it when a group default supplies a `loading`/`error`
 * slot the route lacks, child over group.
 */
export function buildRouteComponent(
    component: ComponentType<any>,
    fold: {
        scope: Scope<any>;
        loading?: ComponentType<any> | undefined;
        error?: ComponentType<any> | undefined;
        ssr?: boolean | undefined;
        keepStale?: boolean | undefined;
        loadingDelayMs?: number | undefined;
        retry?: RetryOption | undefined;
        ssrErrors?: 'retry' | 'dehydrate' | undefined;
    },
): ComponentType<any> {
    return createMandala(
        {
            scope: fold.scope,
            component,
            loading: fold.loading ?? (() => null),
            ...(fold.error ? { error: fold.error } : {}),
            ...(fold.ssr !== undefined ? { ssr: fold.ssr } : {}),
            ...(fold.keepStale !== undefined ? { keepStale: fold.keepStale } : {}),
            ...(fold.loadingDelayMs !== undefined ? { loadingDelayMs: fold.loadingDelayMs } : {}),
            ...(fold.retry !== undefined ? { retry: fold.retry } : {}),
            ...(fold.ssrErrors !== undefined ? { ssrErrors: fold.ssrErrors } : {}),
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
    // Carried so a group's re-fold doesn't silently drop a route's own resolution
    // options (an opt-out turned back on, a stale window that stops keeping).
    ssr?: boolean | undefined;
    keepStale?: boolean | undefined;
    loadingDelayMs?: number | undefined;
    retry?: RetryOption | undefined;
    ssrErrors?: 'retry' | 'dehydrate' | undefined;
};

/**
 * The URL-bound sibling of `island`: folds `options.scope` with the component into a
 * mandala fed the path params. Without a scope, the component renders with the params.
 *
 *     route('/pages/:pageId', 'page', PageBody, { scope: pageScope })
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

    // A supplied scope folds with the component into a mandala; `foldInputs` keeps the fold's
    // inputs so a wrapping `group` can re-fold with its shared slots.
    const routeComponent =
        scopeOption !== undefined
            ? buildRouteComponent(component as ComponentType<any>, {
                  scope: scopeOption as Scope<any>,
                  loading: options.loading as ComponentType<any> | undefined,
                  error: options.error as ComponentType<any> | undefined,
                  ssr: options.ssr as boolean | undefined,
                  keepStale: options.keepStale as boolean | undefined,
                  loadingDelayMs: options.loadingDelayMs as number | undefined,
                  retry: options.retry as RetryOption | undefined,
                  ssrErrors: options.ssrErrors as 'retry' | 'dehydrate' | undefined,
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
                      ssr: options.ssr as boolean | undefined,
                      keepStale: options.keepStale as boolean | undefined,
                      loadingDelayMs: options.loadingDelayMs as number | undefined,
                      retry: options.retry as RetryOption | undefined,
                      ssrErrors: options.ssrErrors as 'retry' | 'dehydrate' | undefined,
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
