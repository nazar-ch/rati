// Production server for the SSR demo: serve the built client bundle, import the built
// server bundle, call `render` per request.
//
// There is no dev branch here any more — `vp dev` is the whole dev story, because the
// rati/vite plugin renders through src/entry-server.tsx inside Vite's own dev server.
// The rest of this file goes the same way in SSR-03, when rati/server ships `serve()`.
//
// Note what is *not* here: no manifest is read, and no hashed script or stylesheet is
// spliced in. The built entry-server already carries them (virtual:rati/assets), so
// this file's only remaining jobs are static files and the three result kinds.

import { createServer as createHttpServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, extname, resolve, join } from 'node:path';
import { existsSync, createReadStream } from 'node:fs';
import type { RenderAppResult } from 'rati/ssr';

const __dirname = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env['PORT']) || 3000;
const clientDir = join(__dirname, 'dist/client');

type RenderFn = (url: string) => Promise<RenderAppResult>;

// The shell is source, not a build output: it carries no hashed asset, so nothing about
// it changes when the client build does, and the client build has no reason to rewrite
// it. (SSR-03's handler takes it as a value — same read, one layer up.)
const template = await readFile(join(__dirname, 'index.html'), 'utf-8');
const { render } = (await import(resolve(__dirname, 'dist/server/entry-server.js'))) as {
    render: RenderFn;
};

// Static assets need a correct Content-Type — a browser rejects a
// `<script type="module">` served without a JavaScript MIME type.
const MIME_TYPES: Record<string, string> = {
    '.js': 'text/javascript',
    '.mjs': 'text/javascript',
    '.css': 'text/css',
    '.html': 'text/html; charset=utf-8',
    '.json': 'application/json',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.webp': 'image/webp',
    '.woff2': 'font/woff2',
    '.map': 'application/json',
    '.txt': 'text/plain; charset=utf-8',
};

function tryServeStatic(req: IncomingMessage, res: ServerResponse): boolean {
    if (!req.url) return false;
    const filePath = join(clientDir, req.url.split('?')[0]!);
    if (!filePath.startsWith(clientDir)) return false;
    if (!existsSync(filePath) || filePath.endsWith('/')) return false;
    const contentType = MIME_TYPES[extname(filePath)];
    res.writeHead(200, contentType ? { 'Content-Type': contentType } : {});
    createReadStream(filePath).pipe(res);
    return true;
}

// The handler is async, but `createServer`'s listener must return `void` — so the
// promise is wrapped with `void` at the registration site rather than passed directly.
async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
        if (tryServeStatic(req, res)) return;

        const result = await render(req.url || '/');

        // A route-level redirect responds before anything rendered.
        if (result.kind === 'redirect') {
            res.writeHead(result.status, { Location: result.to });
            res.end();
            return;
        }
        // Unreachable with a `*` catch-all in the table; kept for completeness.
        if (result.kind === 'no-match') {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('Not found');
            return;
        }

        const body = template
            .replace('<!--app-head-->', result.headTags)
            .replace('<!--app-html-->', result.html)
            .replace('<!--app-state-->', result.stateScript);

        // result.status already encodes the baseline policy: catch-all → 404,
        // not-available load → 404, failed load → 500 (the HTML still carries the
        // loading slot; the client retries the load after hydration).
        res.writeHead(result.status, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(body);
    } catch (err) {
        console.error(err);
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end(err instanceof Error && err.stack ? err.stack : String(err));
    }
}

const server = createHttpServer((req, res) => void handleRequest(req, res));

server.listen(port, () => {
    console.log(`rati SSR demo listening on http://localhost:${port}`);
});
