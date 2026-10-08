// The production server for the SSR demo, in full: `vp dev` is the whole dev story, and
// the result kinds, the static files, the 500 fallback and the listener are rati/server's.
// What is left is this app's own facts — where the shell is, where the client build went,
// and what renders. No manifest is read: the built entry-server carries the hashed assets
// (virtual:rati/assets).
//
// Run it with `vp run ssr-demo#start`, after `vp run rati#build`: plain node resolves
// `rati/server` through the published entry (dist/), never the `rati-dev` condition.
import { readFile } from 'node:fs/promises';

import { createRequestHandler, serve } from 'rati/server';
import type { RenderAppResult, RenderAssets } from 'rati/ssr';

// The built bundle carries no types, so the app asserts its contract here: `render`, and
// the assets entry-server re-exports for the fallback. Every URL here resolves against
// this file, never the cwd.
const built = new URL('dist/server/entry-server.js', import.meta.url);
const { render, assets } = (await import(built.href)) as {
    render: (url: string) => Promise<RenderAppResult>;
    assets: RenderAssets;
};

// Source, not a build output: the shell carries nothing hashed, so no build rewrites it.
const template = await readFile(new URL('index.html', import.meta.url), 'utf-8');

await serve({
    handler: createRequestHandler({ render, assets, template }),
    staticDir: new URL('dist/client', import.meta.url),
});
