// Minimal SSR server. Dev mode pipes through Vite's middleware (HMR for the
// client, ssrLoadModule for the server entry); prod mode serves the built
// client bundle and imports the built server bundle.

import { createServer as createHttpServer, IncomingMessage, ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { existsSync, createReadStream } from 'node:fs';
import type { ViteDevServer } from 'vite';

const __dirname = dirname(fileURLToPath(import.meta.url));
const isProd = process.env['NODE_ENV'] === 'production';
const port = Number(process.env['PORT']) || 3000;

interface Loader {
    resolveTemplate(url: string): Promise<string>;
    loadServerEntry(): Promise<{ render: (url: string) => Promise<RenderResult> }>;
    middleware: ViteDevServer['middlewares'] | null;
    fixStack(err: unknown): unknown;
}

// FIXME: deduplicate
export interface RenderResult {
    html: string;
    /** Snapshot to embed in the HTML so the client can hydrate without re-fetching. */
    state: unknown;
    /** 200 for matched routes, 404 when no route (including the catch-all) matches. */
    status: 200 | 404;
}

// `</script>` and `<!--` would break the inline script tag, and U+2028 /
// U+2029 are valid in JSON but illegal in JS source — escape all five.
const LINE_SEP = String.fromCharCode(0x2028);
const PARA_SEP = String.fromCharCode(0x2029);
function escapeJsonForScript(value: unknown): string {
    return JSON.stringify(value)
        .replace(/</g, '\\u003c')
        .replace(/>/g, '\\u003e')
        .replace(/&/g, '\\u0026')
        .split(LINE_SEP)
        .join('\\u2028')
        .split(PARA_SEP)
        .join('\\u2029');
}

async function loadDev(): Promise<Loader> {
    const { createServer: createViteServer } = await import('vite');
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
                render: (url: string) => Promise<RenderResult>;
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

function tryServeStatic(req: IncomingMessage, res: ServerResponse): boolean {
    if (!isProd || !req.url) return false;
    const filePath = join(__dirname, 'dist/client', req.url.split('?')[0]!);
    if (!filePath.startsWith(join(__dirname, 'dist/client'))) return false;
    if (!existsSync(filePath) || filePath.endsWith('/')) return false;
    res.writeHead(200);
    createReadStream(filePath).pipe(res);
    return true;
}

const loader = isProd ? await loadProd() : await loadDev();

const server = createHttpServer(async (req, res) => {
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

        const template = await loader.resolveTemplate(url);
        const { render } = await loader.loadServerEntry();
        const { html, state, status } = await render(url);

        const body = template
            .replace('<!--app-html-->', html)
            .replace('<!--app-state-->', escapeJsonForScript(state));

        res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(body);
    } catch (err) {
        loader.fixStack(err);
        console.error(err);
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end(err instanceof Error && err.stack ? err.stack : String(err));
    }
});

server.listen(port, () => {
    console.log(`rati SSR demo listening on http://localhost:${port}`);
});
