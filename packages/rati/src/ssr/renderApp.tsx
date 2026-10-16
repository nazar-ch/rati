import type { ComponentType } from 'react';

import { headTags } from './headTags.js';
import { serializeHydration, type HydrationState } from './payload.js';
import { renderToHtml } from './renderToHtml.js';

import type { HeadStore } from '../head/store.js';
import {
    createHydrationCollector,
    type Hydration,
    type HydrationError,
} from '../mandala/hydration.js';
import { createMemoryHistory, type History } from '../router/history.js';
import { prepareRoute, redirectFromHops } from '../router/prepareRoute.js';
import { toRouterStore, type AnyRouter } from '../router/store.js';

/*
    renderApp — the whole per-request loop in one call: memory history → the app factory →
    prepareRoute → prerender → dispose, returning the decision a server or an SSG script maps
    onto a response. Every piece stays public for a nonstandard flow.
*/

export interface RenderAppSetup {
    /** Memory history at the requested URL — hand it to `createRouter`. */
    history: History;
    /** Collector wiring — spread into the app's HydrationProvider. */
    hydration: Pick<Hydration, 'collect' | 'collectError'>;
}

export interface RenderAppInstance {
    router: AnyRouter;
    App: ComponentType;
    /** This request's head store, when the app declares titles/meta. */
    head?: HeadStore;
}

/**
 * What the built client needs from the page — entry script, stylesheets, a route chunk's
 * preload. `rati/vite` generates this shape as `virtual:rati/assets`, so a server entry hands
 * the module to {@link renderApp} without a manifest; every field is optional.
 */
export interface RenderAssets {
    /**
     * Client entry module(s). React emits them as hydration-tracked
     * `<script type="module">` tags, so the HTML shell needs no script of its own.
     */
    bootstrapModules?: string[];
    /** `<link rel="stylesheet">` tags for the client entry's CSS. */
    styleTags?: string;
    /**
     * Tags that preload a route module's client chunk, keyed as the client manifest
     * keys it. `renderApp` asks for the matched route's `moduleId` (see
     * `prepareRoute`); a route that isn't `lazy()` has none, so nothing is asked.
     */
    preloadTagsFor?: (moduleId: string) => string;
}

export interface RenderAppOptions {
    url: string;
    /**
     * Build a fresh app for this request. One app instance per render — module-level
     * stores would leak state across requests.
     */
    createApp: (setup: RenderAppSetup) => RenderAppInstance;
    /**
     * The built client's tags — normally `import * as assets from 'virtual:rati/assets'`.
     * `bootstrapModules` reaches the prerender; the rest joins `result.headTags`, so
     * assembly places them through the head slot it already has.
     */
    assets?: RenderAssets;
    onError?: (error: unknown) => void;
}

export type RenderAppResult =
    | {
          kind: 'rendered';
          html: string;
          /**
           * Derived: catch-all match → 404, a `not-available` load failure → 404, any
           * other load failure → 500, else 200. A different policy reads `errors` /
           * `matchedCatchAll` and picks its own.
           */
          status: number;
          /**
           * Everything for `<head>`: the `assets` tags (stylesheets, the matched
           * route's chunk preload) followed by the app's own escaped title/meta —
           * empty when there are neither.
           */
          headTags: string;
          /** The hydration payload script tag — splice before `</body>`. */
          stateScript: string;
          hydration: HydrationState;
          errors: HydrationError[];
          matchedCatchAll: boolean;
      }
    | { kind: 'redirect'; to: string; permanent: boolean; status: 301 | 302 }
    /** No route matched at all — a table without a `*` catch-all. */
    | { kind: 'no-match'; status: 404 };

function deriveStatus(matchedCatchAll: boolean, errors: HydrationError[]): number {
    if (matchedCatchAll) return 404;
    if (errors.some((entry) => entry.error.code === 'not-available')) return 404;
    if (errors.length > 0) return 500;
    return 200;
}

/**
 * The built client's `<head>` tags for this request: the entry's stylesheets and the matched
 * route's chunk preload, riding `headTags` so assembly keeps one head slot.
 */
function assetTags(assets: RenderAssets | undefined, moduleId: string | undefined): string {
    if (!assets) return '';
    const preload = moduleId !== undefined ? assets.preloadTagsFor?.(moduleId) : undefined;
    return (assets.styleTags ?? '') + (preload ?? '');
}

export async function renderApp(options: RenderAppOptions): Promise<RenderAppResult> {
    const history = createMemoryHistory({ url: options.url });
    const collector = createHydrationCollector();
    const { router, App, head } = options.createApp({
        history,
        hydration: { collect: collector.collect, collectError: collector.collectError },
    });

    try {
        const prepared = await prepareRoute(router);
        // A null prepare can still carry a redirect: a hop landing outside the route table
        // matches nothing, but the declared 30x stands. The hops are the router's own.
        const redirect = prepared
            ? prepared.redirect
            : redirectFromHops(toRouterStore(router).redirectHops);
        if (redirect) {
            return {
                kind: 'redirect',
                to: redirect.to,
                permanent: redirect.permanent,
                status: redirect.permanent ? 301 : 302,
            };
        }
        if (!prepared) return { kind: 'no-match', status: 404 };

        const bootstrapModules = options.assets?.bootstrapModules;
        const html = await renderToHtml(<App />, {
            ...(bootstrapModules ? { bootstrapModules } : {}),
            ...(options.onError ? { onError: options.onError } : {}),
        });

        // The `errors` section only when an island asked for one (`ssrErrors:
        // 'dehydrate'`), so the payload of an app that never sets the option is unchanged.
        const dehydratedErrors = collector.dehydratedErrors;
        const state = {
            router: prepared.hydratedState,
            data: collector.data,
            seeds: collector.seeds,
            ...(Object.keys(dehydratedErrors).length > 0 ? { errors: dehydratedErrors } : {}),
        };
        return {
            kind: 'rendered',
            html,
            status: deriveStatus(prepared.matchedCatchAll, collector.errors),
            headTags: assetTags(options.assets, prepared.moduleId) + (head ? headTags(head) : ''),
            stateScript: serializeHydration(state),
            hydration: { v: 1, ...state },
            errors: collector.errors,
            matchedCatchAll: prepared.matchedCatchAll,
        };
    } finally {
        router.dispose();
    }
}
