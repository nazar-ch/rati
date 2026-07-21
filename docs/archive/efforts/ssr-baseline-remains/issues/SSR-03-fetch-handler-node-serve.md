# SSR-03 — rati/server: fetch request handler + Node adapter

area: packages/rati/src/server (new), examples/ssr
needs: SSR-01, SSR-02
disposition: —

## Problem

Prod serving is still per-consumer plumbing: status mapping, template assembly, static
files with a copy-pasted MIME table, 500 fallback. Design:
[ssr-server-kit.md](docs/archive/directions-2026-07/ssr-server-kit.md) §Layer 3.
Fetch `Request`/`Response` is the one interface all three real hosts consume (plain
Node via adapter, Vercel natively, Hono directly).

## Scope

1. A new `rati/server` entry: `createRequestHandler({ render, assets, template })` →
   `(request: Request) => Promise<Response>` — result kinds to HTTP for good, including
   the 500 fallback (render threw → the CSR shell with asset tags, no payload).
2. `serve({ handler, staticDir, port })`: a dependency-free `node:http` adapter with
   minimal static serving + the MIME table (single home at last), documented as
   CDN-fronted for real traffic.
3. Delete `examples/ssr/server.ts`: dev = `vite dev` (SSR-01), prod = `serve()`.

## Boundaries

- The anti-bloat lines from the design doc are binding: no framework adapters, no
  streaming, no compression/caching features, no edge-runtime promises.
- Node adapter stays zero-dependency.

## Verify

Example prod run through `serve()`: statuses 200/404/301 as in the baseline
verification, correct Content-Type on module scripts, 500-fallback path exercised by a
route that throws outside islands. Handler-level tests run the fetch handler directly
(no listener) for each result kind.
