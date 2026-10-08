import {
    DEFAULT_PLACEHOLDERS,
    fillTemplate,
    isWholeDocument,
    spliceDocument,
    type Assembler,
    type Placeholders,
} from '../ssr/html.js';
import type { RenderAppResult, RenderAssets } from '../ssr/renderApp.js';

/*
    The production request handler: `render`'s result kinds become HTTP. Fetch is the whole
    interface, the shape Hono, Vercel and the Node adapter already speak — never a router, a
    static file server or a middleware stack.
*/

export interface RequestHandlerOptions {
    /**
     * The server entry's `render(url)`, returning `renderApp`'s result — in production, the
     * app's built entry.
     */
    render: (url: string) => Promise<RenderAppResult>;
    /**
     * The HTML shell as a string, read by the caller — source, nothing hashed. A
     * whole-document app has none, and unset is how the CSR fallback knows it serves one.
     */
    template?: string;
    /**
     * The `virtual:rati/assets` the server entry hands `renderApp`, re-exported from the
     * entry. Only the CSR fallback reads it; without it a failed render answers a bare 500.
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
            // docs/current/public/ssr.md.
            return html(result.status, assemble(options, placeholders, result));
        } catch (error) {
            onError(error, request);
            // The fallback answers a RENDER failure. `Unservable` is a misconfigured handler
            // instead, and the fallback reads `template === undefined` as a whole-document
            // app, so it answers plain text.
            if (error instanceof Unservable) return text(500, 'Internal Server Error');
            return fallback(options, placeholders);
        }
    };
}

/**
 * The handler is configured in a way that cannot produce a page — not a render that
 * failed. Private: `onError` hands the developer the message, and the only decision the
 * type carries is the one in the catch above.
 */
class Unservable extends Error {}

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
        // Here the two readings of `template === undefined` disagree: this app renders
        // fragments, so the unset option is a mistake, where the fallback below can only
        // read it as "whole-document app". Hence `Unservable` rather than a plain Error
        // — see the catch.
        throw new Unservable(
            'rati/server — createRequestHandler({ template }) is unset and the app rendered ' +
                'a fragment, so there is nothing to render it into. Pass your index.html; ' +
                'only a whole-document app (one that renders `<html>` itself) needs no shell.',
        );
    }
    return fillTemplate(options.template, result, placeholders, BY);
}

/**
 * A render that threw is a server-side bug; the app may still work in a browser, so this
 * serves the shell it would have hydrated — same assets, no payload — at 500. A
 * whole-document app gets a synthesized shell; without a client entry it answers plain text.
 */
function fallback(options: RequestHandlerOptions, placeholders: Placeholders): Response {
    const modules = options.assets?.bootstrapModules;
    if (!modules?.length) return text(500, 'Internal Server Error');

    const styleTags = options.assets?.styleTags ?? '';
    const scriptTags = modules
        .map((src) => `<script type="module" src="${src}"></script>`)
        .join('');

    // No template IS the whole-document app — the option means the shell, and there is
    // no shell to fill. Synthesize the minimal one the entry needs.
    if (options.template === undefined) {
        return html(500, synthesizeDocument(styleTags, scriptTags));
    }
    try {
        // The scripts take the HEAD slot, the only one that can hold them: `<!--app-html-->`
        // sits in `#root`, which the client entry clears, and `<!--app-state-->` is the
        // payload's. A module script defers, so it runs after parsing from either place.
        return html(
            500,
            fillTemplate(
                options.template,
                { html: '', headTags: styleTags + scriptTags, stateScript: '' },
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

/**
 * The fallback's shell for a whole-document app: the assets and nothing else. React clears
 * a document container SPARINGLY, keeping `SCRIPT`, `STYLE` and `LINK rel="stylesheet"`, so
 * any other markup vanishes on mount. `charset` rides the Content-Type header.
 */
function synthesizeDocument(styleTags: string, scriptTags: string): string {
    return `<!doctype html><html><head>${styleTags}</head><body>${scriptTags}</body></html>`;
}

function html(status: number, body: string): Response {
    return new Response(body, { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

function text(status: number, body: string): Response {
    return new Response(body, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}
