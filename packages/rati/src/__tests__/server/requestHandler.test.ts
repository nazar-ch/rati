// @vitest-environment node
import { describe, test, expect, vi } from 'vite-plus/test';

import { createRequestHandler } from '../../server/requestHandler';
import type { RenderAppResult } from '../../ssr/renderApp';

/*
    The fetch handler, driven directly: a `Request` in, a `Response` out, no listener
    and no app. `render` is the whole coupling — canned results are the contract — and
    the assembly under it is covered in ../ssr/html.test.ts.
*/

const TEMPLATE = `<!doctype html><html><head><!--app-head--></head>
<body><div id="root"><!--app-html--></div><!--app-state--></body></html>`;

const RENDERED: Extract<RenderAppResult, { kind: 'rendered' }> = {
    kind: 'rendered',
    html: '<h1>home</h1>',
    status: 200,
    headTags: '<title>home</title>',
    stateScript: '<script id="__rati-hydration">{"v":1}</script>',
    hydration: { v: 1, data: {}, seeds: {} },
    errors: [],
    matchedCatchAll: false,
};

const ASSETS = {
    bootstrapModules: ['/assets/entry-a1b2.js'],
    styleTags: '<link rel="stylesheet" href="/assets/index-c3d4.css">',
};

/** The handler under test, over a `render` that answers with `result`. */
function handlerFor(
    result: RenderAppResult | (() => Promise<RenderAppResult>),
    options: Partial<Parameters<typeof createRequestHandler>[0]> = {},
) {
    return createRequestHandler({
        render: typeof result === 'function' ? result : () => Promise.resolve(result),
        template: TEMPLATE,
        ...options,
    });
}

function get(handler: (request: Request) => Promise<Response>, path = '/') {
    return handler(new Request(`http://app.test${path}`));
}

describe('rendered', () => {
    test('fills the template and serves it as HTML', async () => {
        const response = await get(handlerFor(RENDERED));
        const body = await response.text();

        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
        expect(body).toContain('<head><title>home</title></head>');
        expect(body).toContain('<div id="root"><h1>home</h1></div>');
        expect(body).toContain('id="__rati-hydration"');
    });

    test.for([404, 500] as const)('serves the result status as-is (%s)', async (status) => {
        // The status is the policy `renderApp` already derived; the handler does not
        // form a second opinion about it.
        const response = await get(handlerFor({ ...RENDERED, status }));

        expect(response.status).toBe(status);
        expect(await response.text()).toContain('<h1>home</h1>');
    });

    test('hands render the path and query, not the origin', async () => {
        const render = vi.fn(() => Promise.resolve(RENDERED));
        await get(handlerFor(render), '/products/1?tab=reviews');

        expect(render).toHaveBeenCalledWith('/products/1?tab=reviews');
    });

    test('splices into a whole document instead of the template', async () => {
        const document = '<!doctype html><html><head></head><body><div>app</div></body></html>';
        const response = await get(handlerFor({ ...RENDERED, html: document }, { template: '' }));

        expect(await response.text()).toContain('<title>home</title></head>');
    });
});

describe('redirect', () => {
    test.for([
        [true, 301],
        [false, 302],
    ] as const)('answers permanent=%s with %s and Location', async ([permanent, status]) => {
        const response = await get(
            handlerFor({ kind: 'redirect', to: '/products/1', permanent, status }),
        );

        expect(response.status).toBe(status);
        expect(response.headers.get('location')).toBe('/products/1');
        expect(await response.text()).toBe('');
    });
});

describe('no-match', () => {
    test('answers 404 in plain text', async () => {
        const response = await get(handlerFor({ kind: 'no-match', status: 404 }));

        expect(response.status).toBe(404);
        expect(response.headers.get('content-type')).toBe('text/plain; charset=utf-8');
        expect(await response.text()).toBe('Not found');
    });
});

describe('the CSR fallback', () => {
    const boom = () => Promise.reject(new Error('render exploded'));

    test('serves the shell with the assets and no payload', async () => {
        const onError = vi.fn();
        const response = await get(handlerFor(boom, { assets: ASSETS, onError }));
        const body = await response.text();

        expect(response.status).toBe(500);
        expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
        // The whole point: the client entry loads, so the page still works.
        expect(body).toContain('<script type="module" src="/assets/entry-a1b2.js"></script>');
        expect(body).toContain('<link rel="stylesheet" href="/assets/index-c3d4.css">');
        // Nothing was rendered, so there is nothing to hydrate and nothing to hydrate
        // from — an empty root and no payload is what makes the client boot from
        // scratch rather than mismatch against a half-page.
        expect(body).toContain('<div id="root"></div>');
        expect(body).not.toContain('__rati-hydration');
    });

    test('reports the error that caused it', async () => {
        const onError = vi.fn();
        const request = new Request('http://app.test/');
        await handlerFor(boom, { assets: ASSETS, onError })(request);

        expect(onError).toHaveBeenCalledWith(expect.any(Error), request);
        expect(onError.mock.calls[0]?.[0]).toMatchObject({ message: 'render exploded' });
    });

    test('synthesizes a document when there is no template', async () => {
        // A whole-document app has no shell to fill, which is what the unset option
        // says — so the assets become one. Asserted whole rather than piecewise: React
        // sweeps everything but script/style/stylesheet out of a document container on
        // mount, so anything else that appears here would silently vanish client-side.
        const handler = createRequestHandler({ render: boom, assets: ASSETS, onError: vi.fn() });
        const response = await get(handler);

        expect(response.status).toBe(500);
        expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
        expect(await response.text()).toBe(
            '<!doctype html><html>' +
                '<head><link rel="stylesheet" href="/assets/index-c3d4.css"></head>' +
                '<body><script type="module" src="/assets/entry-a1b2.js"></script></body>' +
                '</html>',
        );
    });

    test('answers plainly when there is no client entry to boot', async () => {
        // No assets: the shell would load nothing, so a blank page dressed as a working
        // one helps no one.
        const response = await get(handlerFor(boom, { onError: vi.fn() }));

        expect(response.status).toBe(500);
        expect(response.headers.get('content-type')).toBe('text/plain; charset=utf-8');
        expect(await response.text()).toBe('Internal Server Error');
    });

    test('answers plainly with neither a template nor assets', async () => {
        // The same reasoning one pattern over: a synthesized document that names no
        // entry is a blank page with a 500 on it. This is the answer SSR-12 left alone.
        const response = await get(createRequestHandler({ render: boom, onError: vi.fn() }));

        expect(response.status).toBe(500);
        expect(response.headers.get('content-type')).toBe('text/plain; charset=utf-8');
        expect(await response.text()).toBe('Internal Server Error');
    });

    test('answers plainly when the shell cannot take the tags', async () => {
        // A template with nowhere to put the script: assembly refuses to drop it, and
        // the fallback refuses to bury the original error under that.
        const onError = vi.fn();
        const response = await get(
            handlerFor(boom, { assets: ASSETS, template: '<html></html>', onError }),
        );

        expect(response.status).toBe(500);
        expect(await response.text()).toBe('Internal Server Error');
        expect(onError).toHaveBeenCalledOnce();
    });

    test('catches a template that cannot take the render', async () => {
        // Assembly's own refusal (a shell with no `<!--app-state-->` would hydrate from
        // scratch and look fine) reaches the same place as any other failure.
        const onError = vi.fn();
        const response = await get(
            handlerFor(RENDERED, {
                template: '<html><!--app-head--><!--app-html--></html>',
                onError,
            }),
        );

        expect(response.status).toBe(500);
        expect(onError.mock.calls[0]?.[0]).toMatchObject({
            message: expect.stringContaining('the hydration payload would be dropped'),
        });
    });

    test('names the missing template when the app rendered a fragment', async () => {
        const onError = vi.fn();
        const handler = createRequestHandler({ render: () => Promise.resolve(RENDERED), onError });
        await get(handler);

        expect(onError.mock.calls[0]?.[0]).toMatchObject({
            message: expect.stringContaining('createRequestHandler({ template }) is unset'),
        });
    });

    // SSR-15. The handler's own misconfiguration is not a render failure, and must not
    // be answered by the shape above: a fragment app with no template threads the gap
    // between the two readings of `template === undefined` — `assemble` throws its
    // config error (the app rendered a fragment), and the fallback, seeing no template,
    // would synthesize a whole-document shell with no `#root` for that app's entry to
    // boot into. Plain text is what this answered before SSR-12 built the fallback, and
    // it was honest.
    //
    // Kill: requestHandler.ts, the catch — drop the `error instanceof Unservable` line
    // → the assets synthesize an `<html>` this app cannot run (executed: red here, and
    // nowhere else in the suite).
    test('answers plainly when a fragment app has no template, assets or not', async () => {
        const onError = vi.fn();
        const handler = createRequestHandler({
            render: () => Promise.resolve(RENDERED),
            assets: ASSETS,
            onError,
        });
        const response = await get(handler);

        expect(response.status).toBe(500);
        expect(response.headers.get('content-type')).toBe('text/plain; charset=utf-8');
        expect(await response.text()).toBe('Internal Server Error');
        // The developer still gets the real reason — the guard changes the answer on the
        // wire, not the report.
        expect(onError.mock.calls[0]?.[0]).toMatchObject({
            message: expect.stringContaining('createRequestHandler({ template }) is unset'),
        });
    });
});
