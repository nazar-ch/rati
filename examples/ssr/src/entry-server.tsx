import { renderApp, type RenderAppResult } from 'rati/ssr';
// What the built client needs from the page — the hashed entry script, its stylesheet
// links, and each lazy route's chunk preload. The rati/vite plugin generates it from
// the client build it just ran, so these are values, not a manifest to find at runtime:
// in dev the same import is the source entry and no links.
import * as assets from 'virtual:rati/assets';
import { createApp } from './createApp';

export type { RenderAppResult };

// Re-exported for serve.ts: `virtual:rati/assets` exists only inside the build, and the
// production server is a plain node script that was never part of one. It hands them to
// createRequestHandler, which needs them for exactly one page — the shell it serves if
// this render throws.
export { assets };

/**
 * The whole per-request loop is `renderApp`: memory history → a fresh app →
 * `prepareRoute` → prerender → dispose. The result is a decision object the server
 * maps onto the response — rendered (html + derived status + headTags + stateScript),
 * redirect (respond 30x before rendering anything), or no-match.
 */
export function render(url: string): Promise<RenderAppResult> {
    return renderApp({ url, createApp, assets });
}
