# SSR server kit — Layers 2/3 design

Status: designed 2026-07-14 (maintainer-confirmed direction: "a good foundation to build
on top of; everything goes to `rati/*`, slicing is for later"). Implementation is the
ssr-baseline-remains effort ([docs/archive/efforts/ssr-baseline-remains/](docs/archive/efforts/ssr-baseline-remains/)),
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

### The fallback for whole-document apps (SSR-12 design pass, 2026-07-16)

The fallback above needs a shell to fill and a script to put in it; a whole-document app
has neither, so a render that throws answers the plain-text 500. SSR-04 met this on nazar
and kept whole-document deliberately. The question the item asks is not nazar's — it is
whether the pattern should *structurally* lack a fallback for the projects that do want
one. It doesn't have to: the constraint the item was filed on turns out not to exist.

**The spike.** The item's premise — "React has no `createRoot(document)`: a client-only
render of a component that returns `<html>` has no supported mount call" — is false in
React 19.2. Two mounts work against a synthesized minimal document (the asset tags, no app
markup, no payload), verified twice each: jsdom, and Chrome against a dev server.

- **`createRoot(document).render(<App/>)`** produces a working page — content rendered,
  `<html lang>` applied, the stylesheet loaded *and applied*, the button interactive — on
  a **clean console**. It is not an accident that it works: DefinitelyTyped's `Container`
  includes `Document`, `isValidContainer` accepts `nodeType === 9`, `clearContainer` has a
  dedicated document branch, and the only dev warning on the path is about double-rooting
  one container.
- **`hydrateRoot(document, <App/>)`** — shape (1) as filed — reaches the same working page
  through mismatch recovery, and says so: an `onRecoverableError` call, which is a
  `console.error` by default.

One React detail carries both, and is worth naming because the shape rests on it: the
clear before a client render into a document is `clearContainerSparingly`, which keeps
`SCRIPT`, `STYLE` and `LINK rel="stylesheet"` and drops everything else. A synthesized
document holds exactly those, so the mount cannot orphan the entry that is running it.

**Weighing the three shapes, with that in hand.** (1) survives, in a better form than it
was filed in: synthesize the document, and let the client entry *mean* it — `createRoot`,
not a mismatch React forgives. That removes the objection to (1) (it "leans on recovery
semantics and logs a hydration error") rather than trading it away. (2) — an app-authored
`fallbackDocument` plus a client-side branch — buys nothing once the branch is
`createRoot(document)`: the app would be hand-writing a document the handler can already
synthesize from `assets`, and "more surface, honest semantics" collapses to just more
surface. (3) — declare the exclusivity permanent — was the honest read while the mount was
believed not to exist; it isn't, so the reason is gone.

**The shape, then.** No new option: `template === undefined` is *already* the handler's
"this is a whole-document app" signal (that is what the option means, and what `assemble`
tells a fragment-rendering app that omitted it). So the fallback branches where it already
branches — a template to fill → fill it; no template, but `assets` → synthesize
`<!doctype html><html><head>{styleTags}</head><body>{bootstrapModules}</body></html>`;
neither → the plain-text 500 stands, unchanged. Status stays 500 throughout.

Two consequences to carry, not one:

- **The client entry's cooperation again** — the same note SSR-03 recorded for the
  template pattern, one container over: a whole-document entry branches
  `readHydration()` → payload → `hydrateRoot(document, <App/>)`, null →
  `createRoot(document).render(<App/>)`. Without the branch the fallback still *works*,
  via recovery, while filling the console — which is exactly the failure SSR-03 already
  documented for `#root`. `docs/public/ssr.md` §The client entry shows only the `#root`
  pair today.
- **Supportedness is the one soft spot.** react.dev documents `createRoot`'s container as
  "a DOM element" and mentions `document` only under `hydrateRoot`. The types, the runtime
  branch and two browsers say otherwise, but the docs page does not — so this rests on
  observed behavior over a stated contract, and a React release could in principle move it
  where `hydrateRoot(document)` could not.

Open for the maintainer, ahead of implementation: whether that soft spot is acceptable (if
not, shape (1)-as-filed still works — noisy console, no reliance on `createRoot`'s
container); and whether inferring the pattern from `template === undefined` is the right
signal or wants to be explicit.

**Decided 2026-07-16 (maintainer): both confirmed.** The soft spot is accepted and
`template === undefined` stays the signal — no new option. One addition rides the
acceptance: a canary pin in the test suite renders a synthesized document through
`createRoot(document)` and asserts the working page, so a React release that narrows the
container is caught by rati's own gate, not by a consumer's 500 path; the documented
fallback if that ever fires is shape (1)-as-filed (`hydrateRoot` + recovery). The SSR-12
item record carries the implementation scope.

#### As implemented (SSR-12, 2026-07-16)

Shipped as decided: `fallback` branches on the unset `template`, `synthesizeDocument`
emits the shape above verbatim, status 500 throughout, no new option. Two notes, since
this file is the design of record.

- **The spike's "a `console.error` by default" is wrong, and it matters for the pin.**
  React's default `onRecoverableError` is `reportGlobalError`, not `console.error`
  (`react-dom-client.development.js:9417`). The observable claim holds — a browser shows
  an uncaught error, so shape (1) is still the noisy one — but a console spy does *not*
  see a recovery: under Vitest it lands as an unhandled error, which fails no assertion.
  So the canary asserts on an `onRecoverableError` it passes itself, and this was verified
  the only way that matters: swapped to `hydrateRoot`, the pin goes red on that assertion
  and green on the console one. A console-only canary would have passed the very shape it
  exists to distinguish.
- **`exactOptionalPropertyTypes` makes the signal sharper than it reads.** Under
  `@tsconfig/strictest` (rati's, and any consumer's) `template?: string` cannot *take*
  `undefined` — omitting the option is the only way to say it. So "unset" is a deliberate
  act rather than a value that can arrive by accident from a conditional.

## Anti-bloat lines (binding)

- Fetch `Request`/`Response` is the only server interface — no Express/Koa/framework
  adapters beyond the Node listener.
- No streaming SSR (`prerender` stays all-or-nothing; the per-island `ssr: false`
  option in [scope-and-island-directions.md §2](docs/research/scope-and-island-directions.md) is the pressure valve).
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
