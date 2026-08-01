// The production server for the SSR demo, in full. There is no dev branch here (`vp
// dev` is the whole dev story — rati/vite renders every request through
// src/entry-server.tsx inside Vite's own dev server), and there is no plumbing: the
// three result kinds, the static files and their MIME types, the 500 fallback and the
// listener are all rati/server's now. What is left is this app's three facts — where
// the shell is, where the client build went, and what renders.
//
// Note what is still *not* here: no manifest is read, and no hashed script or
// stylesheet is spliced in. The built entry-server carries them (virtual:rati/assets).
//
// Run it with `vp run ssr-demo#start`, after `vp run rati#build` — plain node resolves
// `rati/server` through the published entry (dist/), not the `rati-dev` condition that
// Vite uses to read the source. A real consumer installs the package and skips that.
import { readFile } from 'node:fs/promises';

import { createRequestHandler, serve } from 'rati/server';
import type { RenderAppResult, RenderAssets } from 'rati/ssr';

// The built bundle carries no types of its own, so this is the one place the app
// asserts a contract instead of inferring it — the Layer-1 `render`, plus the assets
// entry-server re-exports for the fallback. The URL is resolved against this file
// rather than the cwd, like the two below; a specifier TypeScript can't follow is also
// what leaves the assertion something to assert.
const built = new URL('dist/server/entry-server.js', import.meta.url);
const { render, assets } = (await import(built.href)) as {
    render: (url: string) => Promise<RenderAppResult>;
    assets: RenderAssets;
};

// Source, not a build output: the shell carries nothing hashed, so no build rewrites it
// and there is nothing to keep in sync. The handler takes it as a value.
const template = await readFile(new URL('index.html', import.meta.url), 'utf-8');

await serve({
    handler: createRequestHandler({ render, assets, template }),
    staticDir: new URL('dist/client', import.meta.url),
});
