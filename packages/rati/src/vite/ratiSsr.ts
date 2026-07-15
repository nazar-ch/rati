import { readFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';

import { normalizePath, type Manifest, type Plugin, type ViteDevServer } from 'vite';

import {
    DEFAULT_PLACEHOLDERS,
    fillTemplate,
    isWholeDocument,
    spliceDocument,
    type Assembler,
    type Placeholders,
    type RenderedParts,
} from '../ssr/html';
import { ASSETS_MODULE, RESOLVED_ASSETS_MODULE, buildAssets, devAssets } from './assets';
import { findLazyCalls, recordModuleIds } from './lazyModules';

import type { RenderAppResult } from '../ssr/renderApp';

/*
    `rati/vite`: `vite dev` serves the app and `vite build` builds both sides of it, so
    an SSR app needs no server of its own and no build script of its own.

    Dev — Vite's dev server already does the hard parts (transform, HMR, sourcemaps);
    what every consumer hand-rolled around it was the same ~150 lines of middleware-mode
    piping. So this is a catch-all HTML middleware inside Vite's own server: load the
    app's server entry, call the Layer-1 contract (`render(url)` → `RenderAppResult`),
    map the result kinds onto the response.

    Build — an SSR app is two builds over one source tree, which consumers ran as two
    commands and then re-joined by hand at runtime by reading the client manifest. The
    environments API makes them one command, and being the thing that runs both is what
    lets the plugin hand the client's manifest to the server build (see ./assets) rather
    than leave every consumer to find it in production.

    The render contract is the whole coupling — this plugin knows nothing about rati's
    engine and rati's engine knows nothing about it.
*/

export interface RatiSsrOptions {
    /**
     * The server entry, resolved by Vite (a `/src/…` path is root-relative). It exports
     * `render(url): Promise<RenderAppResult>` — normally a one-liner over `renderApp`.
     * Default: `/src/entry-server.tsx`.
     */
    entry?: string;
    /**
     * The client entry — the module that hydrates. It is the client build's input, and
     * `virtual:rati/assets` reports it (hashed, with its CSS) as the script the page
     * loads, so your HTML shell carries no `<script>` of its own.
     * Default: `/src/entry-client.tsx`.
     */
    clientEntry?: string;
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
    /** Where the two builds land, relative to the Vite root. */
    outDir?: {
        /** The browser's half — assets plus the manifest. Default: `dist/client`. */
        client?: string;
        /** The server's half — the built `entry`. Default: `dist/server`. */
        server?: string;
    };
}

interface ResolvedOptions {
    entry: string;
    clientEntry: string;
    template: string;
    placeholders: Placeholders;
    clientOutDir: string;
    serverOutDir: string;
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
        clientEntry: options.clientEntry ?? '/src/entry-client.tsx',
        template: options.template ?? 'index.html',
        placeholders: { ...DEFAULT_PLACEHOLDERS, ...options.placeholders },
        clientOutDir: options.outDir?.client ?? 'dist/client',
        serverOutDir: options.outDir?.server ?? 'dist/server',
    };

    let root = '';
    /** The client entry as the manifest keys it — set once the root is known. */
    let clientEntryKey = '';
    /**
     * The client build's manifest, kept from the run that produced it. Reading the
     * written file instead would let a stale one from an older build reach the server
     * bundle, which is a wrong-hash page that looks fine until the browser 404s.
     */
    let clientManifest: Manifest | undefined;

    return {
        name: 'rati:ssr',
        // One instance across both builds — the client build is where the manifest
        // exists and the server build is where it is needed.
        sharedDuringBuild: true,

        config() {
            return {
                // An SSR app has no static index.html to serve: `custom` drops Vite's
                // SPA middlewares so the renderer below is the only fallback.
                appType: 'custom',
                // Opt into the app builder, so one `vite build` runs both environments
                // (and `buildApp` below decides their order).
                builder: {},
                environments: {
                    client: {
                        build: {
                            outDir: resolved.clientOutDir,
                            // The join between the builds: hashed file names on one
                            // side, the server naming them on the other.
                            manifest: true,
                            rollupOptions: { input: fsPath(resolved.clientEntry) },
                        },
                    },
                    ssr: {
                        build: {
                            outDir: resolved.serverOutDir,
                            rollupOptions: { input: fsPath(resolved.entry) },
                        },
                    },
                },
            };
        },

        configResolved(config) {
            root = config.root;
            clientEntryKey = manifestKey(root, resolve(root, fsPath(resolved.clientEntry)));
        },

        async buildApp(builder) {
            const client = builder.environments['client'];
            const ssr = builder.environments['ssr'];
            if (!client || !ssr) {
                throw new Error(
                    'rati:ssr — the build needs both a client and an ssr environment; ' +
                        `found ${Object.keys(builder.environments).join(', ') || 'none'}.`,
                );
            }
            // Client first, and not for speed: the server build inlines the client's
            // manifest, so it cannot start until those hashes exist.
            await builder.build(client);
            await builder.build(ssr);
        },

        writeBundle(_options, bundle) {
            if (this.environment.name !== 'client') return;
            const manifestName = this.environment.config.build.manifest;
            const emitted =
                bundle[typeof manifestName === 'string' ? manifestName : '.vite/manifest.json'];
            if (emitted?.type === 'asset') {
                clientManifest = JSON.parse(String(emitted.source)) as Manifest;
            }
        },

        resolveId(id) {
            return id === ASSETS_MODULE ? RESOLVED_ASSETS_MODULE : null;
        },

        load(id) {
            if (id !== RESOLVED_ASSETS_MODULE) return null;
            // Dev serves the source entry through the module graph; only a build has
            // hashes to name.
            if (this.environment.mode !== 'build') return devAssets(resolved.clientEntry);
            if (!clientManifest) {
                throw new Error(
                    `rati:ssr — ${ASSETS_MODULE} needs the client manifest, and this build ` +
                        `has not produced one. It is imported by a server build; run the ` +
                        `whole app build (\`vite build\`), which builds the client first.`,
                );
            }
            return buildAssets(clientManifest, clientEntryKey, this.environment.config.base);
        },

        async transform(code, id) {
            // Build-time metadata: dev has no chunks to preload, and the client bundle
            // has no use for the ids — the server is what reads them.
            if (this.environment.mode !== 'build' || this.environment.name !== 'ssr') return null;
            // Ids carry Vite's query suffixes (`?v=`, `?import`); the parser wants the
            // extension, which is what tells it this is TSX.
            const calls = findLazyCalls(code, id.split('?')[0] ?? id, 'rati');
            if (calls.length === 0) return null;

            const ids: { at: number; moduleId: string }[] = [];
            for (const call of calls) {
                const target = await this.resolve(call.specifier, id);
                // Unresolvable is not this transform's error to raise: the import stays
                // as written, and the bundler reports it as it would have anyway.
                if (target) ids.push({ at: call.at, moduleId: manifestKey(root, target.id) });
            }
            if (ids.length === 0) return null;
            // No source map: every id goes in on one line, after the code it follows,
            // so nothing above or below it moves.
            return { code: recordModuleIds(code, ids), map: null };
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

/**
 * An entry option as a build input. The options are Vite paths — `/src/…` means the
 * root, not the filesystem — while rollup resolves a relative input against the root,
 * which is the same place.
 */
function fsPath(entry: string): string {
    return entry.startsWith('/') ? entry.slice(1) : entry;
}

/** How the client manifest keys a module: its path from the root, POSIX-separated. */
function manifestKey(root: string, absolute: string): string {
    return normalizePath(relative(root, absolute));
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
    const by: Assembler = {
        name: 'rati:ssr',
        template: options.template,
        option: 'ratiSsr({ placeholders })',
    };
    if (isWholeDocument(result.html)) {
        // No template, so the rendered document is the shell: splice around React's
        // output, then transform it so the document still gets the dev client.
        return server.transformIndexHtml(url, spliceDocument(result.html, result, by), originalUrl);
    }
    const raw = await readFile(resolve(server.config.root, options.template), 'utf8');
    // Transform the shell, *then* fill it: transforming the filled page would hand the
    // app's own markup to Vite's HTML pipeline.
    const template = await server.transformIndexHtml(url, raw, originalUrl);
    return fillTemplate(template, result, options.placeholders, by);
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
