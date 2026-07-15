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

### As implemented (SSR-02, 2026-07-15)

Layer 2 shipped as designed; three details settled differently, recorded here because
this file is the design of record.

- **The transform is the primary — it doesn't fight the bundler.** It parses with
  `parseSync`, matches only calls to a local bound to rati's `lazy` (React's is left
  alone), and appends the root-relative module id as a second argument. The literal
  import is untouched, so splitting is unaffected; the ids ride only in the ssr build.
  The `routeChunks` fallback is unused, and unnecessary.
- **`preloadTagsFor(moduleId)`, not `(routeName)`.** Route names are a runtime fact of
  the app's table — a build-time module can only key by name if the app hand-writes the
  mapping, which *is* the `routeChunks` fallback. The transform records modules, so the
  module id is the key that needs no app input. `prepareRoute` surfaces the matched
  route's id (it already reaches into the component for `preload()`).
- **`renderApp` folds the tags in; the handler doesn't splice them.** The server entry
  must import the assets module regardless (only it can pass `bootstrapModules` to the
  prerender), so passing the whole module is one import and one option instead of two
  places. And it is the only spot that works for all three assemblers: the dev
  middleware never sees the generated module, so splicing in the handler would leave dev
  without the behaviour and hand-rolled servers to do it themselves. The tags join
  `result.headTags` — assembly already has one head slot, and a second part would mean a
  new placeholder in every template. Layer 3 is smaller for it: `createRequestHandler({
  render, template })`, no `assets`.

One consequence beyond the plugin: since the assets module names the entry, `index.html`
stops being a build input and becomes only a shell. nazar's already is one in all but
name ("Build input only […] The dev/prod servers don't serve this markup") — SSR-04
deletes it outright.

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

### As implemented (SSR-03, 2026-07-15)

Layer 3 shipped as designed. Three notes, recorded here because this file is the design
of record.

- **`assets` is back, for the fallback alone.** SSR-02's note above concluded Layer 3
  needs no `assets` — true of a page that *rendered*, whose tags `renderApp` folds into
  `headTags`. The fallback is the case it doesn't cover: a render that threw has no
  result to fold into, and since SSR-02 the shell carries no `<script>` of its own, so
  "serve the CSR shell with the assets tags" (this section, unchanged) has no way to
  name the entry without them. So `createRequestHandler({ render, assets, template })`
  after all — the option is used for nothing else, and an app that would rather answer a
  bare 500 omits it. The consequence for consumers: the server entry must re-export the
  assets it imports, since `virtual:rati/assets` exists only inside the build and no
  production server is part of one.
- **The fallback needs the client entry's cooperation**, which the design didn't say. No
  payload means React hydrating an empty root against a tree that renders something — a
  mismatch it reports and then recovers from by client-rendering anyway. So the client
  entry branches: `readHydration()` → null → `createRoot`, not `hydrateRoot`. Without
  that the fallback "works" while filling the console with errors.
- **`html.ts` moved to `ssr/`.** Two things assemble now, and neither is the plugin's to
  own; its refusals take the caller's identity so each names its own option.

The validation path's first consumer is done: `examples/ssr/server.ts` is deleted, dev
runs on `vite dev`, prod on `serve()` — ~90 lines to ~12. nazar.ch and the jnana website
are SSR-04/05.

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
