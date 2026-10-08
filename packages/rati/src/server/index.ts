/*
    rati/server — production serving: `createRequestHandler`, fetch-shaped for Hono, Vercel, Bun
    or Deno, and `serve` for plain Node. Dev is `vite dev`; usage is docs/current/public/ssr.md.
*/
export { createRequestHandler, type RequestHandlerOptions } from './requestHandler.js';
export { serve, type ServeOptions } from './node.js';
