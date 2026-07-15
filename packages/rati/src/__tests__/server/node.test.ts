// @vitest-environment node
import { describe, test, expect, beforeAll, afterAll, vi } from 'vite-plus/test';

import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { serve, staticPath } from '../../server/node';

/*
    The Node adapter over a real socket: the translation is the whole job, so a fake
    listener would test nothing. The handler is a stand-in that echoes what reached it —
    what a real one does with a request is requestHandler.test.ts's business.
*/

let server: Server;
let origin: string;
let staticDir: string;

/** What the handler saw, so the tests can assert on the translation into fetch. */
const seen = vi.fn();

async function fixture(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'rati-serve-'));
    await mkdir(join(dir, 'assets'));
    await writeFile(join(dir, 'assets', 'entry-a1b2.js'), 'export const hydrate = 1;\n');
    await writeFile(join(dir, 'assets', 'index-c3d4.css'), '.page { color: red }\n');
    await writeFile(join(dir, 'favicon.ico'), 'icon');
    await writeFile(join(dir, 'my file.txt'), 'spaces');
    await writeFile(join(dir, 'unknown.bin'), 'bytes');
    return dir;
}

beforeAll(async () => {
    staticDir = await fixture();
    server = await serve({
        // Port 0: the OS picks a free one, so the suite can't collide with anything
        // (or with itself).
        port: 0,
        staticDir,
        handler: async (request) => {
            seen(request);
            return new Response(`handled ${new URL(request.url).pathname}`, {
                status: 418,
                headers: { 'Content-Type': 'text/plain', 'X-From': 'handler' },
            });
        },
    });
    const address = server.address();
    if (typeof address !== 'object' || !address) throw new Error('server reported no address');
    origin = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
    await new Promise((done) => server.close(done));
});

function get(path: string, init?: RequestInit): Promise<Response> {
    return fetch(`${origin}${path}`, { redirect: 'manual', ...init });
}

describe('static files', () => {
    test.for([
        ['/assets/entry-a1b2.js', 'text/javascript'],
        ['/assets/index-c3d4.css', 'text/css'],
        ['/favicon.ico', 'image/x-icon'],
        // The one that has to be right: a browser refuses a module script served
        // without a JavaScript type, and that is the whole reason for the table.
        ['/my%20file.txt', 'text/plain; charset=utf-8'],
        ['/unknown.bin', 'application/octet-stream'],
    ] as const)('serves %s as %s', async ([path, type]) => {
        const response = await get(path);

        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toBe(type);
        expect(response.headers.get('content-length')).toBe(
            String((await response.arrayBuffer()).byteLength),
        );
    });

    test('serves the file, byte for byte', async () => {
        expect(await (await get('/assets/entry-a1b2.js')).text()).toBe(
            'export const hydrate = 1;\n',
        );
    });

    test('answers HEAD with the headers and no body', async () => {
        const response = await get('/assets/entry-a1b2.js', { method: 'HEAD' });

        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toBe('text/javascript');
        expect(await response.text()).toBe('');
    });

    test('leaves a path it has no file for to the handler', async () => {
        // Not a 404 from here: an unknown path is a route the app may well have, and
        // the app's own not-found page is the better answer than this server's opinion.
        const response = await get('/products/1');

        expect(response.status).toBe(418);
        expect(await response.text()).toBe('handled /products/1');
    });

    test('leaves a directory to the handler', async () => {
        expect((await get('/assets/')).status).toBe(418);
    });
});

describe('staticPath', () => {
    /*
        Unit-tested rather than driven over the socket, because a client won't send the
        interesting requests: `fetch` folds `..` away before it goes out. The request
        that means it is hand-written, so hand it paths.
    */
    const dir = '/srv/app/dist/client';

    test('maps a path onto a file under the dir', () => {
        expect(staticPath(dir, '/assets/entry-a1b2.js?v=1')).toBe(
            '/srv/app/dist/client/assets/entry-a1b2.js',
        );
    });

    test('decodes a percent-escape, so a real filename with a space resolves', () => {
        expect(staticPath(dir, '/my%20file.txt')).toBe('/srv/app/dist/client/my file.txt');
    });

    test.for([
        ['/%2e%2e%2f%2e%2e%2f.env', 'an encoded parent'],
        ['/assets%2f..%2f..%2f..%2fetc/passwd', 'an encoded climb'],
    ] as const)('refuses to leave the dir: %s (%s)', ([url]) => {
        // The case the containment check is for, and the only one that reaches it: an
        // encoded slash is not a path separator to the URL parser, so it comes through
        // normalization intact and turns back into a traversal the moment it's decoded.
        expect(staticPath(dir, url)).toBeUndefined();
    });

    test.for([
        ['/../client-secrets/keys.json', '/srv/app/dist/client/client-secrets/keys.json'],
        ['/assets/../../../etc/passwd', '/srv/app/dist/client/etc/passwd'],
        ['/%2e%2e/%2e%2e/.env', '/srv/app/dist/client/.env'],
    ] as const)('resolves a plain traversal inside the dir: %s', ([url, file]) => {
        // Not the check doing the work here — URL normalization already folded these
        // and clamped them at the root, so they name an in-dir file that doesn't exist
        // and the request goes to the handler. Worth pinning: it is why the obvious
        // attack is boring, and the encoded one above isn't.
        expect(staticPath(dir, url)).toBe(file);
    });

    test.for([
        ['/assets/', 'a directory'],
        ['/%ZZ', 'a malformed escape'],
        ['/x%00.js', 'a null byte'],
    ] as const)('names no file for %s (%s)', ([url]) => {
        expect(staticPath(dir, url)).toBeUndefined();
    });
});

describe('the fetch translation', () => {
    test('hands the handler the url, method and headers', async () => {
        await get('/about?x=1', { headers: { 'X-Test': 'yes' } });
        const request = seen.mock.lastCall?.[0] as Request;

        expect(request.method).toBe('GET');
        expect(new URL(request.url).pathname + new URL(request.url).search).toBe('/about?x=1');
        expect(request.headers.get('x-test')).toBe('yes');
    });

    test('carries a request body through', async () => {
        // Nothing rati renders needs one; the adapter still must not drop it, because
        // the handler it wraps is not always rati's.
        await get('/submit', { method: 'POST', body: 'name=rati' });
        const request = seen.mock.lastCall?.[0] as Request;

        expect(request.method).toBe('POST');
        expect(await request.text()).toBe('name=rati');
    });

    test('writes the response status, headers and body back', async () => {
        const response = await get('/about');

        expect(response.status).toBe(418);
        expect(response.headers.get('x-from')).toBe('handler');
        expect(await response.text()).toBe('handled /about');
    });
});

describe('without a static dir', () => {
    test('sends everything to the handler', async () => {
        // The CDN-fronted shape: something else serves the files.
        const bare = await serve({
            port: 0,
            handler: () => Promise.resolve(new Response('app', { status: 200 })),
        });
        const address = bare.address();
        if (typeof address !== 'object' || !address) throw new Error('no address');

        try {
            const response = await fetch(`http://127.0.0.1:${address.port}/assets/entry.js`);

            expect(response.status).toBe(200);
            expect(await response.text()).toBe('app');
        } finally {
            await new Promise((done) => bare.close(done));
        }
    });
});

describe('a handler that throws', () => {
    test('answers 500 rather than hanging the socket', async () => {
        // createRequestHandler answers its own failures, so this is the case where the
        // handler is someone else's — a dropped request is the one outcome that isn't
        // allowed.
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        const broken = await serve({
            port: 0,
            handler: () => Promise.reject(new Error('handler exploded')),
        });
        const address = broken.address();
        if (typeof address !== 'object' || !address) throw new Error('no address');

        try {
            const response = await fetch(`http://127.0.0.1:${address.port}/`);

            expect(response.status).toBe(500);
            expect(await response.text()).toBe('Internal Server Error');
            expect(error).toHaveBeenCalled();
        } finally {
            error.mockRestore();
            await new Promise((done) => broken.close(done));
        }
    });
});
