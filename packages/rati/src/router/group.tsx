import type { ComponentType, ReactNode } from 'react';
import type { Scope } from '../scope/scope';
import { buildRouteComponent, type GenericRouteType } from './route';

/**
 * Defaults a {@link group} applies to each of its child routes. Children override the
 * group: a route's own `wrapper`/`loading`/`error` always wins over the default here.
 */
export type GroupDefaults = {
    /** Wrapper rendered around every child that doesn't set its own. */
    wrapper?: ComponentType<{ children: ReactNode }> | undefined;
    /** Default mandala loading slot for scope-bearing children lacking one. */
    loading?: ComponentType<any> | undefined;
    /** Default mandala error slot for scope-bearing children lacking one. */
    error?: ComponentType<any> | undefined;
};

/**
 * Apply shared options to a list of routes, removing the per-route duplication of a common
 * `wrapper` (and optionally `loading`/`error`). Returns the routes **unchanged at the type
 * level** — the same flat tuple of literal `name`/`path`/`scope` the router's type
 * machinery reads (`Link`'s `to`, `useRouteContext`) — so a group is purely an authoring
 * convenience: spread it into the `routes` tuple, paths stay absolute.
 *
 *     export const routes = [
 *         route('/', 'index', Index),
 *         ...group({ wrapper: SettingsLayout }, [
 *             route('/settings/', 'settings', Settings),
 *             route('/settings/account', 'settings-account', AccountPage),
 *         ]),
 *     ] as const;
 *
 * Each child keeps its own options; the group only fills the gaps. `wrapper` is applied at
 * render (the Router reads `wrapperComponent`); `loading`/`error` re-fold the child's
 * mandala, so they affect only routes that carry a `scope`.
 */
export function group<const T extends readonly GenericRouteType[]>(
    defaults: GroupDefaults,
    routes: T,
): T {
    return routes.map((route) => {
        // Child wrapper wins; otherwise inherit the group's. Applied at render time.
        const wrapperComponent = route.wrapperComponent ?? defaults.wrapper;

        // Re-fold only when the group adds a slot this route didn't declare, so a
        // wrapper-only group never rebuilds a mandala. Child slots win over the group's.
        let { component } = route;
        const fold = route.foldInputs;
        if (fold) {
            const addsLoading = defaults.loading !== undefined && fold.loading === undefined;
            const addsError = defaults.error !== undefined && fold.error === undefined;
            if (addsLoading || addsError) {
                component = buildRouteComponent(fold.component, {
                    scope: route.scope as Scope<any>,
                    loading: fold.loading ?? defaults.loading,
                    error: fold.error ?? defaults.error,
                    // Not group defaults — the route's own, carried through the rebuild.
                    ssr: fold.ssr,
                    keepStale: fold.keepStale,
                    loadingDelayMs: fold.loadingDelayMs,
                    retry: fold.retry,
                });
            }
        }

        return { ...route, wrapperComponent, component };
    }) as unknown as T;
}
