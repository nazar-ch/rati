import {
    DEFAULT_PLACEHOLDERS,
    fillTemplate,
    isWholeDocument,
    spliceDocument,
    type Assembler,
    type Placeholders,
} from '../ssr/html';

import type { RenderAppResult, RenderAssets } from '../ssr/renderApp';

/*
    The production request handler: `render`'s result kinds become HTTP, for good.

    Fetch is the whole interface. Not because edge runtimes are a goal, but because it
    is the one shape the real hosts already speak — Hono passes `c.req.raw`, Vercel
    functions take a fetch handler natively, and the Node listener next door is a
    ~40-line adapter. Nothing here is platform-specific, so nothing here needs a
    platform.

    What it is not: a router, a static file server, a middleware stack. The app's route
    table already routes; a CDN already serves files. This maps three result kinds and a
    failure onto four responses.
*/

export interface RequestHandlerOptions {
    /**
     * The server entry's `render(url)` — the Layer-1 contract (`renderApp`'s result).
     * In production that is the built entry: `const { render } = await import(
     * './dist/server/entry-server.js')`.
     */
    render: (url: string) => Promise<RenderAppResult>;
    /**
     * The HTML shell, as a string — the file is yours to read (it is source, not a
     * build output, so nothing about it is hashed). Whole-document apps have none: if
     * `render` returns a full `<html>`, the parts splice into it instead.
     */
    template?: string;
    /**
     * The same `virtual:rati/assets` the server entry hands `renderApp` — re-export it
     * from the entry to reach it here. Only the CSR fallback below reads it (a rendered
     * page carries its own tags, folded in by `renderApp`), so an app that would rather
     * answer a failed render with a bare 500 leaves it out.
     */
    assets?: RenderAssets;
    /** The comments the template carries — match `ratiSsr({ placeholders })`. */
    placeholders?: {
        head?: string;
        html?: string;
        state?: string;
    };
    /**
     * A render that threw, on its way to a 500. Defaults to `console.error`: a server
     * that answers 500 and says nothing is a bug you get to debug from the status code
     * alone.
     */
    onError?: (error: unknown, request: Request) => void;
}

export function createRequestHandler(
    options: RequestHandlerOptions,
): (request: Request) => Promise<Response> {
    const placeholders: Placeholders = { ...DEFAULT_PLACEHOLDERS, ...options.placeholders };
    const onError = options.onError ?? ((error: unknown) => console.error(error));

    return async function handleRequest(request: Request): Promise<Response> {
        try {
            // The router matches on path + query, and the app's own URLs are
            // same-origin — the origin the request arrived on is the proxy's business,
            // not the route table's.
            const url = new URL(request.url);
            const result = await options.render(url.pathname + url.search);

            if (result.kind === 'redirect') {
                // 301/302 per `permanent`, decided before anything rendered.
                return new Response(null, {
                    status: result.status,
                    headers: { Location: result.to },
                });
            }
            if (result.kind === 'no-match') {
                // Only reachable without a `*` catch-all in the route table.
                return text(result.status, 'Not found');
            }

            // `result.status` is already the baseline policy — catch-all → 404, a
            // not-available load → 404, a failed load → 500. See
            // docs/public/ssr.md §Response statuses.
            return html(result.status, assemble(options, placeholders, result));
        } catch (error) {
            onError(error, request);
            return fallback(options, placeholders);
        }
    };
}

const BY: Assembler = {
    name: 'rati/server',
    template: 'the template',
    option: 'createRequestHandler({ placeholders })',
};

function assemble(
    options: RequestHandlerOptions,
    placeholders: Placeholders,
    result: Extract<RenderAppResult, { kind: 'rendered' }>,
): string {
    if (isWholeDocument(result.html)) return spliceDocument(result.html, result, BY);
    if (options.template === undefined) {
        throw new Error(
            'rati/server — createRequestHandler({ template }) is unset and the app rendered ' +
                'a fragment, so there is nothing to render it into. Pass your index.html; ' +
                'only a whole-document app (one that renders `<html>` itself) needs no shell.',
        );
    }
    return fillTemplate(options.template, result, placeholders, BY);
}

/**
 * A render that threw is a server-side bug (a failing load is not — the island catches
 * that one and the status carries it). The app itself may still be fine in a browser,
 * so rather than an error page, serve the shell it would have hydrated: same assets, no
 * payload, so the client boots and resolves from scratch. The status stays 500 — the
 * render did fail, and a crawler should be told so.
 *
 * It needs a shell to fill and a script to put in it. Without either there is nothing
 * to serve but the truth.
 */
function fallback(options: RequestHandlerOptions, placeholders: Placeholders): Response {
    const modules = options.assets?.bootstrapModules;
    if (options.template === undefined || !modules?.length) {
        return text(500, 'Internal Server Error');
    }
    const tags =
        (options.assets?.styleTags ?? '') +
        modules.map((src) => `<script type="module" src="${src}"></script>`).join('');
    try {
        return html(
            500,
            fillTemplate(
                options.template,
                { html: '', headTags: tags, stateScript: '' },
                placeholders,
                BY,
            ),
        );
    } catch {
        // The shell has no head slot — the app is unservable client-side too, and this
        // is already the error path. The original error was reported; don't bury it
        // under a second one.
        return text(500, 'Internal Server Error');
    }
}

function html(status: number, body: string): Response {
    return new Response(body, { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

function text(status: number, body: string): Response {
    return new Response(body, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}
