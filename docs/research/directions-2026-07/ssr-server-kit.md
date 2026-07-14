# SSR server kit — Layers 2/3 design

Status: designed 2026-07-14 (maintainer-confirmed direction: "a good foundation to build
on top of; everything goes to `rati/*`, slicing is for later"). Implementation is the
ssr-baseline-remains effort ([docs/planned/ssr-baseline-remains/](../../planned/ssr-baseline-remains/)),
items SSR-01…03.

## Why a kit at all

The 2026-07 SSR baseline made the *entry-server* a one-liner (`renderApp`), but every
consumer still copies ~150–230 lines of server: Vite middleware-mode piping,
`ssrLoadModule`, dev/prod template resolution, client-manifest reading for hashed
entry + CSS tags, a MIME table for static files. nazar.ch and the jnana website carry
diverged copies today; nazar's Vercel function additionally hand-solves manifest path
resolution (`/var/task` vs `import.meta.url`). That plumbing — not the render loop — is
the adoption barrier, and it is exactly the layer where modern Vite frameworks use a
plugin instead of a hand-rolled server.

## The layer model

- **Layer 1 — `renderApp` (shipped).** Pure per-request loop; also the SSG per-URL loop.
  Everything below composes it and stays optional — any app can drop back to Layer 1 or
  to the raw pieces.
- **Layer 2 — the Vite plugin (`rati/vite`).** Owns dev serving and the two-sided build.
- **Layer 3 — the production handler (`rati/server`).** Fetch-shaped request handler +
  a thin Node adapter.

## Layer 2 — `rati/vite`

One plugin, two jobs:

**Dev: no user server at all.** `configureServer` installs a catch-all HTML middleware
in Vite's own dev server: load `/src/entry-server.tsx` via `ssrLoadModule`, call its
exported `render(url)` (the Layer-1 contract: returns `RenderAppResult`), map the
result kinds onto the response, run the assembled HTML through `transformIndexHtml`,
`ssrFixStacktrace` + the error overlay on failure. `vite dev` becomes the whole dev
story; the plugin watches the server entry and full-reloads on change. Entry path and
template placeholders (`<!--app-head-->` / `<!--app-html-->` / `<!--app-state-->`)
are conventions with plugin options to override; the whole-document pattern (no
template) is supported by detecting a full-document `html` in the result and splicing
instead of replacing.

**Build: orchestrate both sides + own the manifest.** Using the Vite environments API,
one `vite build` produces `dist/client` (with manifest) and `dist/server`. The plugin
exposes a virtual module (e.g. `virtual:rati/assets`) the server entry imports:
`{ bootstrapModules, styleTags }` resolved from the manifest in prod and to
`/src/entry-client.tsx` + nothing in dev — deleting the manifest-reading code from
every consumer, including the serverless-path pitfalls.

**Modulepreload for lazy routes** lands here, because only the plugin holds both ends:
which chunk a `lazy()` route maps to (via a small transform that records the import
specifier on the lazy component, resolved through the manifest at build time) and which
route matched (from `prepareRoute`/`renderApp`, which already knows the route). The
assets module then answers `preloadTagsFor(routeName)` and the handler splices them —
closing the "hydrate, then waterfall on the route chunk" gap noted in the baseline
round. The specifier-recording transform is the one open design question with real
unknowns; if it fights the bundler, the fallback is an explicit app-provided
`routeChunks` map, still checked against the manifest.

## Layer 3 — `rati/server`

`createRequestHandler({ render, assets, template })` → `(request: Request) =>
Promise<Response>`. Fetch is the one interface that covers the expected usages with no
per-platform code: Hono `app.all('*', (c) => handler(c.req.raw))` (jnana website),
Vercel functions take fetch handlers natively (nazar), Bun/Deno/workers are fetch-shaped
by construction. The handler is where the result kinds become HTTP for good: 30x with
`Location`, HTML with the derived status, the 500 fallback (render threw → serve the
CSR shell with the assets tags and no payload).

Plus one thin Node adapter: `serve({ handler, staticDir, port })` — `node:http`
wrapping the fetch handler, minimal static serving with the MIME table (currently
copy-pasted in three places), documented as "fine at this scale; put a CDN in front for
real traffic". No compression, no clustering — that's the fronting proxy's job.

## Anti-bloat lines (binding)

- Fetch `Request`/`Response` is the only server interface — no Express/Koa/framework
  adapters beyond the Node listener.
- No streaming SSR (`prerender` stays all-or-nothing; the per-island `ssr: false`
  option in [improvements.md §2](./improvements.md) is the pressure valve).
- Fetch-shaped means edge runtimes *probably* work; untested is unsupported — no
  promises.
- No basename/i18n/proxy/caching features in the kit; escape hatches at every seam.
- Packaging: `rati/vite` and `rati/server` entries on the existing package (per the
  maintainer: no separate packages for now; slicing is a later decision). `vite`
  becomes an optional peer next to `react-dom`; the Node adapter stays dependency-free.

## Validation path

The kit lands when `examples/ssr`'s `server.ts` is deleted in favor of it (dev via
`vite dev`, prod via `serve()`), then nazar.ch and the jnana website migrate — three
consumers, three different hosts (plain Node, Vercel function, Hono), one plumbing
implementation.
