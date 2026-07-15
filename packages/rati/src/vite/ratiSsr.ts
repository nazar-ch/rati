import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import type { Plugin, ViteDevServer } from 'vite';

import {
    DEFAULT_PLACEHOLDERS,
    fillTemplate,
    isWholeDocument,
    spliceDocument,
    type Placeholders,
    type RenderedParts,
} from './html';

import type { RenderAppResult } from '../ssr/renderApp';

/*
    The dev half of `rati/vite`: `vite dev` serves the app, and an SSR app needs no
    server of its own.

    Vite's dev server already does the hard parts (transform, HMR, sourcemaps); what
    every consumer hand-rolled around it was the same ~150 lines of middleware-mode
    piping. So this is a catch-all HTML middleware inside Vite's own server: load the
    app's server entry, call the Layer-1 contract (`render(url)` → `RenderAppResult`),
    map the result kinds onto the response.

    The contract is the whole coupling — this plugin knows nothing about rati's engine
    and rati's engine knows nothing about it.
*/

export interface RatiSsrOptions {
    /**
     * The server entry, resolved by Vite (a `/src/…` path is root-relative). It exports
     * `render(url): Promise<RenderAppResult>` — normally a one-liner over `renderApp`.
     * Default: `/src/entry-server.tsx`.
     */
    entry?: string;
    /**
     * The HTML template, relative to the Vite root. Unused by whole-document apps (the
     * rendered `<html>` is its own template). Default: `index.html`.
     */
    template?: string;
    /** The comments the template carries. Defaults to rati's conventional three. */
    placeholders?: {
        head?: string;
        html?: string;
        state?: string;
    };
}

interface ResolvedOptions {
    entry: string;
    template: string;
    placeholders: Placeholders;
}

/** What the middleware decided; writing it can no longer fail. */
interface Reply {
    status: number;
    headers: Record<string, string>;
    body: string;
}

type RenderFn = (url: string) => Promise<RenderAppResult>;

export function ratiSsr(options: RatiSsrOptions = {}): Plugin {
    const resolved: ResolvedOptions = {
        entry: options.entry ?? '/src/entry-server.tsx',
        template: options.template ?? 'index.html',
        placeholders: { ...DEFAULT_PLACEHOLDERS, ...options.placeholders },
    };

    return {
        name: 'rati:ssr',

        config() {
            // An SSR app has no static index.html to serve: `custom` drops Vite's SPA
            // middlewares so the renderer below is the only fallback.
            return { appType: 'custom' };
        },

        configureServer(server) {
            // Returning a hook installs the middleware *after* Vite's own, so module
            // and HMR requests never reach the renderer.
            return () => {
                server.middlewares.use((req, res, next) => {
                    if (res.writableEnded) {
                        next();
                        return;
                    }
                    // Vite's base middleware already stripped the base from `url` and
                    // kept the full one on `originalUrl` — the app router wants the
                    // former, `transformIndexHtml` the latter.
                    const url = req.url ?? '/';
                    void reply(server, resolved, url, req.originalUrl)
                        .then((decided) => {
                            res.writeHead(decided.status, decided.headers);
                            res.end(decided.body);
                        })
                        .catch((error: unknown) => {
                            // Map the trace back onto source, then hand it to Vite's
                            // error middleware — it logs and serves the overlay.
                            if (error instanceof Error) server.ssrFixStacktrace(error);
                            next(error);
                        });
                });
            };
        },

        hotUpdate({ file, modules, server }) {
            // The server entry's graph is not HMR-safe. `ssrLoadModule` re-evaluates it
            // on the next request, but nothing asks the browser to make one — so reload
            // for modules only the server renders. A module the client graph also has is
            // Fast Refresh's to handle, and reloading would throw its state away.
            if (this.environment.name !== 'ssr' || modules.length === 0) return;
            const client = server.environments.client;
            if (client.moduleGraph.getModulesByFile(file)?.size) return;
            client.hot.send({ type: 'full-reload' });
        },
    };
}

async function reply(
    server: ViteDevServer,
    options: ResolvedOptions,
    url: string,
    originalUrl: string | undefined,
): Promise<Reply> {
    const render = await loadRender(server, options.entry);
    const result = await render(url);

    if (result.kind === 'redirect') {
        return { status: result.status, headers: { Location: result.to }, body: '' };
    }
    if (result.kind === 'no-match') {
        // Only reachable without a `*` catch-all in the route table.
        return {
            status: result.status,
            headers: { 'Content-Type': 'text/plain; charset=utf-8' },
            body: 'Not found',
        };
    }

    return {
        // Already the baseline policy — catch-all → 404, a not-available load → 404, a
        // failed load → 500. See docs/public/ssr.md §Response statuses.
        status: result.status,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
        body: await assemble(server, options, result, url, originalUrl),
    };
}

async function assemble(
    server: ViteDevServer,
    options: ResolvedOptions,
    result: RenderedParts,
    url: string,
    originalUrl: string | undefined,
): Promise<string> {
    if (isWholeDocument(result.html)) {
        // No template, so the rendered document is the shell: splice around React's
        // output, then transform it so the document still gets the dev client.
        return server.transformIndexHtml(url, spliceDocument(result.html, result), originalUrl);
    }
    const raw = await readFile(resolve(server.config.root, options.template), 'utf8');
    // Transform the shell, *then* fill it: transforming the filled page would hand the
    // app's own markup to Vite's HTML pipeline.
    const template = await server.transformIndexHtml(url, raw, originalUrl);
    return fillTemplate(template, result, options.placeholders, options.template);
}

async function loadRender(server: ViteDevServer, entry: string): Promise<RenderFn> {
    const module = await server.ssrLoadModule(entry);
    const render: unknown = module['render'];
    if (typeof render !== 'function') {
        throw new Error(
            `rati:ssr — ${entry} does not export \`render\`. A rati server entry exports ` +
                `\`render(url)\` returning renderApp(…)'s result; see docs/public/ssr.md. ` +
                `Point elsewhere with ratiSsr({ entry }).`,
        );
    }
    return render as RenderFn;
}
