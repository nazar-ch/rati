// @vitest-environment node
import { describe, test, expect, beforeAll, afterAll } from 'vite-plus/test';

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createServer, type ViteDevServer } from 'vite-plus';

import { ratiSsr } from '../../vite/ratiSsr';

/*
    The plugin against a real Vite dev server: every result kind mapped onto a real
    response, over a real socket. `fixture/entry-server.ts` hands back canned
    `RenderAppResult`s — the contract is the whole coupling, so nothing here needs a
    rati app (and assembly's string work is covered in html.test.ts).
*/

const root = resolve(dirname(fileURLToPath(import.meta.url)), 'fixture');

let server: ViteDevServer;
let origin: string;

/**
 * Vite reports the URL it actually bound — it picks the port itself (5173, or the next
 * free one, so a running dev server can't flake the suite) and binds `localhost`, which
 * resolves to ::1 here: a hardcoded 127.0.0.1 would find nothing listening.
 */
async function startServer(entry: string): Promise<{ server: ViteDevServer; origin: string }> {
    const started = await createServer({
        root,
        configFile: false,
        logLevel: 'silent',
        plugins: [ratiSsr({ entry })],
    });
    await started.listen();
    const local = started.resolvedUrls?.local[0];
    if (!local) throw new Error('vite reported no local url');
    return { server: started, origin: local.replace(/\/$/, '') };
}

beforeAll(async () => {
    ({ server, origin } = await startServer('/entry-server.ts'));
});

afterAll(async () => {
    await server.close();
});

function get(path: string): Promise<Response> {
    return fetch(`${origin}${path}`, { redirect: 'manual' });
}

describe('rendered', () => {
    test('assembles the template and serves it as HTML', async () => {
        const response = await get('/');
        const body = await response.text();

        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
        expect(body).toContain('<title>fixture</title>');
        expect(body).toContain('<div id="root"><h1>home</h1>');
        expect(body).toContain('id="__rati-hydration"');
    });

    test('runs the template through transformIndexHtml', async () => {
        // The reason the plugin exists rather than a bare middleware: the shell picks up
        // the dev client, so HMR is live on a server-rendered page.
        expect(await (await get('/')).text()).toContain('/@vite/client');
    });

    test('leaves capture references in rendered markup verbatim', async () => {
        expect(await (await get('/')).text()).toContain(`total: $&100 ($'each)`);
    });

    test.for([
        ['/missing', 404],
        ['/broken', 500],
    ] as const)('serves the result status as-is (%s → %s)', async ([path, status]) => {
        // The status is the baseline policy `renderApp` already derived — the plugin
        // passes it through rather than deriving a second opinion.
        expect((await get(path)).status).toBe(status);
    });
});

describe('whole document', () => {
    test('splices into the rendered document instead of the template', async () => {
        const response = await get('/document');
        const body = await response.text();

        expect(response.status).toBe(200);
        expect(body).toContain('<title>fixture</title></head>');
        expect(body).toContain('{"v":1}</script></body>');
        // Still transformed, so a whole-document app gets HMR too.
        expect(body).toContain('/@vite/client');
        // The template was not involved.
        expect(body).not.toContain('<!--app-html-->');
    });

    test('reports a document it cannot splice into', async () => {
        const response = await get('/no-head');

        expect(response.status).toBe(500);
        // The overlay page carries the message as JSON, so match past the escaping.
        expect(await response.text()).toContain('so the head tags would be dropped');
    });
});

describe('redirect', () => {
    test.for([
        ['/old', 301],
        ['/temporary', 302],
    ] as const)('answers %s with %s and Location', async ([path, status]) => {
        const response = await get(path);

        expect(response.status).toBe(status);
        expect(response.headers.get('location')).toBe('/');
        expect(await response.text()).toBe('');
    });
});

describe('no-match', () => {
    test('answers 404 in plain text', async () => {
        const response = await get('/unrouted');

        expect(response.status).toBe(404);
        expect(response.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    });
});

describe('failures', () => {
    test('routes a throwing render to the error overlay', async () => {
        const response = await get('/boom');

        expect(response.status).toBe(500);
        // Vite's error middleware answers with the page that mounts its overlay.
        expect(await response.text()).toContain('render exploded');
    });

    test('names the entry when it exports no render', async () => {
        const bare = await startServer('/entry-client.ts');

        try {
            const response = await fetch(`${bare.origin}/`);

            expect(response.status).toBe(500);
            expect(await response.text()).toContain('does not export `render`');
        } finally {
            await bare.server.close();
        }
    });
});

describe('malformed escape', () => {
    // A URL is user input, and the app already has an answer for a bad one (the router
    // hands the raw segment through, the load reports not-available, 404). Dev must
    // serve *that* — `transformIndexHtml` decodes the URL it is handed, and a URIError
    // out of it lands on the error middleware, replacing the app's answer with a 500
    // overlay: a bad address looking like an app bug, exactly where the developer is
    // watching. Production has always agreed with the app here.
    test.for([
        ['/products/%zz', '<h1>no such product</h1>'],
        ['/document/%zz', '<h1>no such document</h1>'],
        // The other rejected shapes: well-formed hex that decodes to no character, a
        // truncated escape, and a stray `%` — the retry escapes every `%`, so one path
        // per shape is what keeps that claim honest.
        ['/products/%FF', '<h1>no such product</h1>'],
        ['/products/%2', '<h1>no such product</h1>'],
        ['/products/%', '<h1>no such product</h1>'],
    ] as const)('serves what the app answered (%s)', async ([path, marker]) => {
        const response = await get(path);
        const body = await response.text();

        expect(response.status).toBe(404);
        expect(body).toContain(marker);
        // Still assembled and transformed — the URL is bad, the page is not.
        expect(body).toContain('<title>fixture</title>');
        expect(body).toContain('/@vite/client');
    });
});
