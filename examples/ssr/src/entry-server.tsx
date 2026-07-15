import { renderApp, type RenderAppResult } from 'rati/ssr';
// What the built client needs from the page — the hashed entry script, its stylesheet
// links, and each lazy route's chunk preload. The rati/vite plugin generates it from
// the client build it just ran, so these are values, not a manifest to find at runtime:
// in dev the same import is the source entry and no links.
import * as assets from 'virtual:rati/assets';
import { createApp } from './createApp';

export type { RenderAppResult };

/**
 * The whole per-request loop is `renderApp`: memory history → a fresh app →
 * `prepareRoute` → prerender → dispose. The result is a decision object the server
 * maps onto the response — rendered (html + derived status + headTags + stateScript),
 * redirect (respond 30x before rendering anything), or no-match.
 */
export function render(url: string): Promise<RenderAppResult> {
    return renderApp({ url, createApp, assets });
}
