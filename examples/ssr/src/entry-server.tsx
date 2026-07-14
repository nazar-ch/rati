import { renderApp, type RenderAppResult } from 'rati/ssr';
import { createApp } from './createApp';

export type { RenderAppResult };

/**
 * The whole per-request loop is `renderApp`: memory history → a fresh app →
 * `prepareRoute` → prerender → dispose. The result is a decision object the server
 * maps onto the response — rendered (html + derived status + headTags + stateScript),
 * redirect (respond 30x before rendering anything), or no-match.
 */
export function render(url: string): Promise<RenderAppResult> {
    return renderApp({ url, createApp });
}
