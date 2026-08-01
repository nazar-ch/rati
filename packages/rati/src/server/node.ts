import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

/*
    The Node adapter — the only platform-specific code in the kit, and the reason the
    rest of it isn't. Hosts that speak fetch (Vercel, Hono, Bun, Deno) take the handler
    directly; `node:http` is the one that needs a translator, so here is the translator.

    Static files are here rather than in the handler for the same reason: nobody else
    needs them. Vercel serves `dist/client` off its CDN, Hono has serve-static, and a
    real deployment of this puts something in front anyway. What is left is the MIME
    table, which every consumer had copy-pasted — a browser rejects a
    `<script type="module">` served without a JavaScript type, so nobody got to skip it.
    It lives here now, once.
*/

export interface ServeOptions {
    /** The fetch handler — normally `createRequestHandler(…)`'s. */
    handler: (request: Request) => Promise<Response>;
    /**
     * The built client, served as-is at the paths it names (`dist/client`). A file
     * found here answers; everything else goes to the handler, so an unknown path is
     * the app's own 404 page and not this server's opinion. Omit it when a CDN or a
     * proxy is already serving the assets.
     */
    staticDir?: string | URL;
    /** Default: `$PORT`, or 3000 — the hosts that pick the port announce it that way. */
    port?: number;
}

/** Resolves once the server is listening; the `Server` is yours to `close()`. */
export async function serve(options: ServeOptions): Promise<Server> {
    const staticDir = options.staticDir === undefined ? undefined : toPath(options.staticDir);
    const port = options.port ?? (Number(process.env['PORT']) || 3000);

    const server = createServer((req, res) => {
        // `void`: the listener's contract is synchronous, and reply() below is where
        // every failure is already handled — nothing rejects back to here.
        void reply(options.handler, staticDir, req, res);
    });

    await new Promise<void>((done, fail) => {
        server.once('error', fail);
        server.listen(port, () => {
            server.off('error', fail);
            done();
        });
    });

    const address = server.address();
    const bound = typeof address === 'object' && address ? address.port : port;
    console.log(`rati/server listening on http://localhost:${bound}`);
    return server;
}

async function reply(
    handler: ServeOptions['handler'],
    staticDir: string | undefined,
    req: IncomingMessage,
    res: ServerResponse,
): Promise<void> {
    try {
        if (staticDir !== undefined && (await trySendStatic(staticDir, req, res))) return;
        await sendResponse(await handler(toRequest(req)), res);
    } catch (error) {
        // The handler answers its own failures (that is the point of it) — reaching
        // here means the translation itself broke, or the socket did.
        console.error(error);
        if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Internal Server Error');
    }
}

async function trySendStatic(
    staticDir: string,
    req: IncomingMessage,
    res: ServerResponse,
): Promise<boolean> {
    if (req.method !== 'GET' && req.method !== 'HEAD') return false;

    const file = staticPath(staticDir, req.url ?? '/');
    if (file === undefined) return false;
    const stats = await stat(file).catch(() => undefined);
    if (!stats?.isFile()) return false;

    res.writeHead(200, {
        'Content-Type': MIME_TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream',
        'Content-Length': stats.size,
    });
    if (req.method === 'HEAD') {
        res.end();
        return true;
    }
    await pipeline(createReadStream(file), res);
    return true;
}

/**
 * The file a request path names, or `undefined` for anything that isn't one of ours.
 * The check is containment after resolving, not a prefix test on the request: `join`
 * folds the `..` away first, and `/../client-secrets/x` under `dist/client` resolves to
 * a sibling that a `startsWith(dir)` would happily call a match.
 *
 * Internal, but exported for the test: a browser's fetch folds `..` away before it
 * sends, so a request that tries this can only be built by hand.
 */
export function staticPath(staticDir: string, url: string): string | undefined {
    let pathname: string;
    try {
        // A percent-escape is how a real filename with a space arrives — and how a
        // traversal tries to arrive unnoticed, which is why the containment check
        // below happens after this and not before.
        pathname = decodeURIComponent(new URL(url, 'http://_').pathname);
    } catch {
        return undefined; // A malformed escape names no file.
    }
    if (pathname.endsWith('/') || pathname.includes('\0')) return undefined;

    const file = join(staticDir, pathname);
    return file.startsWith(staticDir + sep) ? file : undefined;
}

function toPath(dir: string | URL): string {
    return resolve(typeof dir === 'string' ? dir : fileURLToPath(dir));
}

function toRequest(req: IncomingMessage): Request {
    const headers = new Headers();
    for (const [name, value] of Object.entries(req.headers)) {
        if (Array.isArray(value)) for (const one of value) headers.append(name, one);
        else if (value !== undefined) headers.set(name, value);
    }

    // The origin is the proxy's business, not ours: the handler reads the path and the
    // query off this, and an app's own URLs are same-origin. So the Host header is
    // enough, and `http` here is not a claim about the scheme the client used.
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const method = req.method ?? 'GET';
    const init: RequestInit & { duplex?: 'half' } = { method, headers };
    if (method !== 'GET' && method !== 'HEAD') {
        // `duplex: 'half'` is required of any streamed body — the request is read, then
        // the response is written, which is the only mode Node's server has anyway.
        init.body = Readable.toWeb(req) as ReadableStream<Uint8Array>;
        init.duplex = 'half';
    }
    return new Request(url, init);
}

async function sendResponse(response: Response, res: ServerResponse): Promise<void> {
    const headers: Record<string, string | string[]> = {};
    response.headers.forEach((value, name) => {
        headers[name] = value;
    });
    // Every other header folds into one comma-joined value; Set-Cookie is the one that
    // must not, so it comes off the side door that keeps the values apart.
    const cookies = response.headers.getSetCookie();
    if (cookies.length > 0) headers['set-cookie'] = cookies;

    res.writeHead(response.status, headers);
    if (!response.body) {
        res.end();
        return;
    }
    await pipeline(Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]), res);
}

/**
 * Enough of the table for a client build's output, and no more — an unknown extension
 * is served `application/octet-stream` rather than left to the browser's sniffer.
 */
const MIME_TYPES: Record<string, string> = {
    '.js': 'text/javascript',
    '.mjs': 'text/javascript',
    '.css': 'text/css',
    '.html': 'text/html; charset=utf-8',
    '.json': 'application/json',
    '.map': 'application/json',
    '.txt': 'text/plain; charset=utf-8',
    '.xml': 'application/xml',
    '.webmanifest': 'application/manifest+json',
    '.wasm': 'application/wasm',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.avif': 'image/avif',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
};
