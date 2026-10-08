import { renderApp, type RenderAppResult } from 'rati/ssr';
// The built client's hashed entry script, stylesheet links and lazy-route preloads, as
// values rati/vite generates from the client build — never a manifest read at runtime. In
// dev it is the source entry and no links.
import * as assets from 'virtual:rati/assets';

import { createApp } from './createApp';

export type { RenderAppResult };

// Re-exported for serve.ts, which no build includes: createRequestHandler needs the
// assets for the shell it serves when this render throws.
export { assets };

/** The per-request loop is `renderApp`'s; rati/server maps its result onto the response. */
export function render(url: string): Promise<RenderAppResult> {
    return renderApp({ url, createApp, assets });
}
