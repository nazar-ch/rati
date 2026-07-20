/*
    rati/server — production serving, in the two pieces a deployment actually has.

    ```ts
    import { createRequestHandler, serve } from 'rati/server';
    // The built server entry: `render`, plus the assets it was built with.
    import { render, assets } from './dist/server/entry-server.js';

    const template = await readFile('index.html', 'utf-8');
    const handler = createRequestHandler({ render, assets, template });

    await serve({ handler, staticDir: 'dist/client' }); // plain Node
    ```

    `createRequestHandler` is fetch-shaped, so the hosts that speak fetch need no
    adapter and no code from here beyond the handler itself:

    ```ts
    app.all('*', (c) => handler(c.req.raw)); // Hono
    export default { fetch: handler };       // Vercel, Bun, Deno, workers
    ```

    Dev is not here at all — `vite dev` is the whole dev story (see `rati/vite`), so
    this is production-only code and there is no branch in it. See docs/current/public/ssr.md.
*/
export { createRequestHandler, type RequestHandlerOptions } from './requestHandler';
export { serve, type ServeOptions } from './node';
