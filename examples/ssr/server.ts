// Minimal SSR server. Dev mode pipes through Vite's middleware (HMR for the
// client, ssrLoadModule for the server entry); prod mode serves the built
// client bundle and imports the built server bundle.

import { createServer as createHttpServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, extname, resolve, join } from 'node:path';
import { existsSync, createReadStream } from 'node:fs';
import type { RenderAppResult } from 'rati/ssr';
import type { ViteDevServer } from 'vite-plus';

const __dirname = dirname(fileURLToPath(import.meta.url));
const isProd = process.env['NODE_ENV'] === 'production';
const port = Number(process.env['PORT']) || 3000;

type RenderFn = (url: string) => Promise<RenderAppResult>;

interface Loader {
    resolveTemplate(url: string): Promise<string>;
    loadServerEntry(): Promise<{ render: RenderFn }>;
    middleware: ViteDevServer['middlewares'] | null;
    fixStack(err: unknown): unknown;
}

async function loadDev(): Promise<Loader> {
    const { createServer: createViteServer } = await import('vite-plus');
    const vite = await createViteServer({
        root: __dirname,
        server: { middlewareMode: true },
        appType: 'custom',
    });

    return {
        async resolveTemplate(url) {
            const raw = await readFile(resolve(__dirname, 'index.html'), 'utf-8');
            return vite.transformIndexHtml(url, raw);
        },
        async loadServerEntry() {
            return vite.ssrLoadModule('/src/entry-server.tsx') as Promise<{
                render: RenderFn;
            }>;
        },
        middleware: vite.middlewares,
        fixStack(err) {
            if (err instanceof Error) vite.ssrFixStacktrace(err);
            return err;
        },
    };
}

async function loadProd(): Promise<Loader> {
    const templatePath = resolve(__dirname, 'dist/client/index.html');
    const template = await readFile(templatePath, 'utf-8');
    const serverEntryPath = resolve(__dirname, 'dist/server/entry-server.js');
    const serverEntry = await import(serverEntryPath);

    return {
        async resolveTemplate() {
            return template;
        },
        async loadServerEntry() {
            return serverEntry;
        },
        middleware: null,
        fixStack(err) {
            return err;
        },
    };
}

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
    if (!isProd || !req.url) return false;
    const filePath = join(__dirname, 'dist/client', req.url.split('?')[0]!);
    if (!filePath.startsWith(join(__dirname, 'dist/client'))) return false;
    if (!existsSync(filePath) || filePath.endsWith('/')) return false;
    const contentType = MIME_TYPES[extname(filePath)];
    res.writeHead(200, contentType ? { 'Content-Type': contentType } : {});
    createReadStream(filePath).pipe(res);
    return true;
}

const loader = isProd ? await loadProd() : await loadDev();

// The handler is async, but `createServer`'s listener must return `void` — so the
// promise is wrapped with `void` at the registration site rather than passed directly.
async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
        const url = req.url || '/';

        if (loader.middleware) {
            // In dev, give Vite a chance to handle module/HMR requests first.
            const handled = await new Promise<boolean>((resolveDone) => {
                loader.middleware!(req, res, () => resolveDone(false));
                res.on('finish', () => resolveDone(true));
                res.on('close', () => resolveDone(true));
            });
            if (handled) return;
        } else if (tryServeStatic(req, res)) {
            return;
        }

        const { render } = await loader.loadServerEntry();
        const result = await render(url);

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

        const template = await loader.resolveTemplate(url);
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
        loader.fixStack(err);
        console.error(err);
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end(err instanceof Error && err.stack ? err.stack : String(err));
    }
}

const server = createHttpServer((req, res) => void handleRequest(req, res));

server.listen(port, () => {
    console.log(`rati SSR demo listening on http://localhost:${port}`);
});
