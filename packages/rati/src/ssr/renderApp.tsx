import type { ComponentType } from 'react';
import type { HeadStore } from '../head/store';
import {
    createHydrationCollector,
    type Hydration,
    type HydrationError,
} from '../mandala/hydration';
import { createMemoryHistory, type History } from '../router/history';
import { prepareRoute } from '../router/prepareRoute';
import type { RouterStore } from '../router/store';
import { headTags } from './headTags';
import { serializeHydration, type HydrationState } from './payload';
import { renderToHtml } from './renderToHtml';

/*
    renderApp — the whole per-request loop in one call: memory history → the app
    factory → prepareRoute → prerender → dispose, returning a decision object the
    server (or an SSG script — the loop is identical per URL) maps onto a response.
    Every piece stays public; an app with a nonstandard flow drops down to them.
*/

export interface RenderAppSetup {
    /** Memory history at the requested URL — hand it to the RouterStore. */
    history: History;
    /** Collector wiring — spread into the app's HydrationProvider. */
    hydration: Pick<Hydration, 'collect' | 'collectError'>;
}

export interface RenderAppInstance {
    router: RouterStore<any>;
    App: ComponentType;
    /** This request's head store, when the app declares titles/meta. */
    head?: HeadStore;
}

export interface RenderAppOptions {
    url: string;
    /**
     * Build a fresh app for this request. One app instance per render — module-level
     * stores would leak state across requests.
     */
    createApp: (setup: RenderAppSetup) => RenderAppInstance;
    bootstrapModules?: string[];
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
          /** Escaped tags for `<head>` — empty when the app passes no head store. */
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

export async function renderApp(options: RenderAppOptions): Promise<RenderAppResult> {
    const history = createMemoryHistory({ url: options.url });
    const collector = createHydrationCollector();
    const { router, App, head } = options.createApp({
        history,
        hydration: { collect: collector.collect, collectError: collector.collectError },
    });

    try {
        const prepared = await prepareRoute(router);
        if (!prepared) return { kind: 'no-match', status: 404 };
        if (prepared.redirect) {
            return {
                kind: 'redirect',
                to: prepared.redirect.to,
                permanent: prepared.redirect.permanent,
                status: prepared.redirect.permanent ? 301 : 302,
            };
        }

        const html = await renderToHtml(<App />, {
            ...(options.bootstrapModules ? { bootstrapModules: options.bootstrapModules } : {}),
            ...(options.onError ? { onError: options.onError } : {}),
        });

        const state = {
            router: prepared.hydratedState,
            data: collector.data,
            seeds: collector.seeds,
        };
        return {
            kind: 'rendered',
            html,
            status: deriveStatus(prepared.matchedCatchAll, collector.errors),
            headTags: head ? headTags(head) : '',
            stateScript: serializeHydration(state),
            hydration: { v: 1, ...state },
            errors: collector.errors,
            matchedCatchAll: prepared.matchedCatchAll,
        };
    } finally {
        router.dispose();
    }
}
