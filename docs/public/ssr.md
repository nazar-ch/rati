# rati — server rendering

How to server-render a rati app: the request loop, the client boot, head management,
response statuses, redirects, and the payload contract. The data-model side — what a
scope is, how islands resolve, the `ssr` source marker — is in the
[guide](./guide.md#server-rendering); this page is the operational half. Everything here
imports from `rati/ssr` unless noted.

## The model in one paragraph

A route's data resolves at render time, so the server can resolve it too: rati renders
under React's `prerender` (from `react-dom/static` — it awaits Suspense, which
`renderToString` cannot), waits for the islands' promise loads, and **dehydrates** the
resolved values. The client reads them back and hydrates without re-running a single
load. You write no server: the [Vite plugin](#the-vite-plugin) serves the app in dev and
builds both sides of it, and the [production handler](#the-production-handler) is a fetch
function your host already knows how to call.

## The server entry

`renderApp` runs the whole per-request loop — memory history → a fresh app →
route matching → prerender → dispose — and returns a decision object:

```tsx
// entry-server.tsx
import { renderApp, type RenderAppResult } from 'rati/ssr';
import * as assets from 'virtual:rati/assets';
import { createApp } from './createApp';

export { assets };

export function render(url: string): Promise<RenderAppResult> {
    return renderApp({ url, createApp, assets });
}
```

`assets` is what the built client needs from the page — the hashed entry script, its
stylesheets, this route's chunk preload. The [plugin](#the-vite-plugin) generates it
from the build it ran, so nothing here reads a manifest. Without the plugin, pass the
same shape (`RenderAssets`) yourself, or nothing at all.

Re-export it (the line above) if you serve through
[`createRequestHandler`](#the-production-handler): `virtual:rati/assets` exists only
inside the build, and your production server is not part of one — so the module that
*was* built is how the values reach it.

`createApp` is the same factory the client uses — it builds one app instance per call
(router, stores, head store) and mounts `HydrationProvider`:

```tsx
// createApp.tsx
export function createApp({ history, hydratedState, hydration }: CreateAppOptions) {
    const router = new RouterStore(routes, { history, hydratedState });
    const head = createHeadStore({ titleTemplate: (title) => `${title} · MySite` });

    function App() {
        return (
            <HeadProvider store={head}>
                <HydrationProvider {...hydration}>
                    <Router />
                </HydrationProvider>
            </HeadProvider>
        );
    }
    return { router, App, head };
}
```

The result is one of three kinds. You don't map them yourself — the [plugin](#dev) does
in dev and the [handler](#the-production-handler) does in production — but this is what
they do with it, and what to do with it if you [serve it yourself](#rolling-your-own-server):

```ts
const result = await render(url);

if (result.kind === 'redirect') {
    // A route-level redirect — respond before anything rendered.
    res.writeHead(result.status, { Location: result.to }); // 301 or 302 per `permanent`
    res.end();
    return;
}
if (result.kind === 'no-match') {
    // No route matched at all (no `*` catch-all in the table).
    res.writeHead(404).end('Not found');
    return;
}
// kind === 'rendered'
const body = template
    .replace('<!--app-head-->', result.headTags)     // assets tags + <title>/<meta> winners
    .replace('<!--app-html-->', result.html)         // the prerendered app
    .replace('<!--app-state-->', result.stateScript); // the hydration payload tag
res.writeHead(result.status, { 'Content-Type': 'text/html; charset=utf-8' });
res.end(body);
```

`result.status` encodes the default policy — see [Response statuses](#response-statuses-and-load-failures).
For a nonstandard flow, every piece `renderApp` composes is public: `prepareRoute`,
`renderToHtml`, `headTags`, `serializeHydration`.

## The client entry

`readHydration()` parses the payload the server embedded; feed its parts back and
hydrate:

```tsx
// entry-client.tsx
import { createRoot, hydrateRoot } from 'react-dom/client';
import { readHydration } from 'rati/ssr';
import { createBrowserHistory } from 'rati';
import { createApp } from './createApp';

const state = readHydration(); // null → client-only boot, resolve from scratch

const { App } = createApp({
    history: createBrowserHistory(),
    hydratedState: state?.router,
    hydration: state ? { data: state.data, seeds: state.seeds } : undefined,
});

const root = document.getElementById('root')!;

if (state) hydrateRoot(root, <App />);
else createRoot(root).render(<App />);
```

**Why the branch.** No payload means no server-rendered HTML to hydrate — a client-only
boot, or the [500 fallback](#the-production-handler) after a render failed. Hydrating an
empty root against a tree that renders something is a mismatch: React reports it, then
recovers by client-rendering anyway. `createRoot` is that outcome without the error.

**Whole-document apps branch the same way**, one container over — your app renders
`<html>` itself, so the container is `document`:

```tsx
if (state) hydrateRoot(document, <App />);
else createRoot(document).render(<App />);
```

The `else` is the [fallback](#when-a-render-throws) shell, and it is worth wiring even
though hydrating would "work": React recovers into the same page, and says so on every
reader's console.

## The Vite plugin

The plugin is your dev server and your build. Add it and an SSR app has neither of its
own:

```ts
// vite.config.ts
import { ratiSsr } from 'rati/vite';

export default defineConfig({
    plugins: [react(), ratiSsr()],
});
```

```ts
// src/vite-env.d.ts — types for the generated module
/// <reference types="rati/vite/client" />
```

The options are the conventions, if you don't share them:

| Option | Default | |
| --- | --- | --- |
| `entry` | `/src/entry-server.tsx` | the module exporting `render` |
| `clientEntry` | `/src/entry-client.tsx` | the module that hydrates; the client build's input |
| `template` | `index.html` | relative to the Vite root |
| `placeholders` | `<!--app-head-->` / `<!--app-html-->` / `<!--app-state-->` | `{ head, html, state }` |
| `outDir` | `dist/client` / `dist/server` | `{ client, server }`, relative to the root |

### Dev

`vite dev` is the whole dev story: a catch-all HTML middleware in Vite's own dev server
loads the server entry, calls its `render(url)`, and maps the kinds onto the response —
the same three-way decision the snippet above spells out, made for you. HMR stays live
(the shell goes through `transformIndexHtml`, so the page gets the dev client), and a
render that throws lands in Vite's error overlay with the stack mapped back onto your
source.

Editing a module only the server renders (the entry, a server-only loader) triggers a
full reload — its graph is not HMR-safe, and nothing else would ask the browser for a
fresh render. Shared components keep Fast Refresh.

### Build

One `vite build` produces `dist/client` (with the manifest) and `dist/server`, in that
order, because the second inlines what the first hashed. That is the point of the plugin
running both: it hands the client's manifest to the server build as
**`virtual:rati/assets`**, so production reads no manifest, resolves no paths, and can't
be handed a stale one.

```ts
import * as assets from 'virtual:rati/assets';
// bootstrapModules  the hashed client entry — '/src/entry-client.tsx' in dev
// styleTags         its stylesheet links — '' in dev (Vite injects styles through JS)
// preloadTagsFor()  a route module's chunk preload — '' in dev (there are no chunks)
```

Hand it to `renderApp` and you are done; it uses what's there. The same import works in
dev, so there is no mode to branch on.

**Migrating: a config that branches on `isSsrBuild` no longer branches.** That flag
answers "is this config call the `--ssr` build?", and under the plugin there is no such
call — `ratiSsr` opts into the app builder, so one `vite build` resolves the config once
and runs both environments from it, with `isSsrBuild: false` every time. A plugin kept
off the server bundle by `!isSsrBuild && plugin()` therefore stops being excluded and
quietly starts running on it. Nothing errors; the wrong artifact is the only symptom.
Scope by environment instead:

```ts
plugins: [
    react(),
    // Was `!isSsrBuild && thirdPartyLicenses()` — a client-only emitter, of no use to
    // a server bundle that runs on your own infra.
    {
        ...thirdPartyLicenses({ fileName: 'third-party-licenses.txt' }),
        applyToEnvironment: (environment) => environment.name === 'client',
    },
    ratiSsr(),
]
```

### Your HTML shell is only a shell

Because the assets module names the entry, `index.html` is **not** a build input: it
carries no `<script>` and no stylesheet, nothing in it is hashed, and no build rewrites
it. Put the app's CSS where it belongs — imported from the client entry — and the
manifest carries it into `styleTags`. Whole-document apps have no shell at all, and need
no `index.html` to bundle their entry.

### Lazy routes are preloaded

A `lazy()` route lives in its own chunk, which the browser can only discover after the
entry runs and React resolves the component — one round trip after the HTML it could
have started during. The plugin closes that: it records which module each `lazy()` call
imports (a transform on the call site — you never write it), resolves it through the
manifest, and the matched route's chunk is named in the page's `<head>`. Nothing about
`lazy()` changes; without the plugin there is simply no id and no preload.

Two behaviours worth knowing:

- **Whole-document apps need no template.** If `render` returns a full `<html>` document,
  the plugin splices the head tags and payload into it (before `</head>` / `</body>`)
  instead of filling a template — no configuration, it just looks at what you rendered.
- **It won't drop anything quietly.** A part with nowhere to go is an error, not a
  best-effort page: a template missing `<!--app-state-->` would serve, hydrate from
  scratch, and look fine while SSR stopped paying for itself.

## The production handler

`createRequestHandler` turns the render loop into a fetch function: a `Request` in, a
`Response` out, with the result kinds mapped onto HTTP. That is the whole interface,
because it is the one every host already speaks.

```ts
import { createRequestHandler, serve } from 'rati/server';
// The built server entry — `render`, plus the `assets` it re-exports.
import { render, assets } from './dist/server/entry-server.js';

const template = await readFile('index.html', 'utf-8');
const handler = createRequestHandler({ render, assets, template });
```

| Option | | |
| --- | --- | --- |
| `render` | required | the server entry's `render(url)` |
| `template` | | your HTML shell, as a string. Whole-document apps have none |
| `assets` | | `virtual:rati/assets`, for the [fallback](#when-a-render-throws) only |
| `placeholders` | | match `ratiSsr({ placeholders })` if you renamed them |
| `onError` | `console.error` | a render that threw, on its way to a 500 |

Then hand it to whatever you deploy on:

```ts
app.all('*', (c) => handler(c.req.raw));  // Hono
export default { fetch: handler };        // Vercel, Bun, Deno, workers
await serve({ handler, staticDir: 'dist/client' }); // plain Node — below
```

Nothing in the handler is platform-specific, and nothing in it reads a manifest or
resolves a path: the built entry carries its own tags ([`virtual:rati/assets`](#build)).
Fetch-shaped means edge runtimes probably work — untested is unsupported, so no promises.

### When a render throws

A failing *load* is not this: the island catches it, the HTML ships the loading slot, and
`result.status` carries the failure. But an error outside every island — a bug in your
shell, a route `wrapper` that throws — rejects `renderApp`, and there is no partial page
to send.

So the handler sends the shell the app would have hydrated: your template, the `assets`
tags, an empty root, **no payload**. The client entry sees no payload, calls `createRoot`
(see [the client entry](#the-client-entry)), and resolves from scratch — a reader still
gets the app. The status stays **500**: the render did fail, and a crawler should be told.

**Whole-document apps get it too.** There is no shell to fill, so the handler synthesizes
the minimal one — `<!doctype html>`, the `assets` tags, nothing else — and your client
entry mounts `createRoot(document)` onto it. No option asks for this: no `template` is
already what "this app renders `<html>` itself" means here.

All it needs is `assets` — a client entry it can name. Without them the answer is a
plain-text 500, in either pattern: a shell that loads nothing is a blank page with a 500
on it. Note this is a *production* answer: in dev the [plugin](#dev) hands the same throw
to Vite's error overlay instead.

**What the whole-document one rests on**, since it is worth knowing: `createRoot(document)`.
React's docs describe the container as "a DOM element" and mention `document` only under
`hydrateRoot` — but the types, the runtime and browsers all take it, and a client render
into a document clears it *sparingly*, keeping scripts and stylesheets. That is what lets
the synthesized shell hold the very entry that mounts it. rati pins the behaviour in its
own suite, so a React release that narrowed the container fails there rather than in your
500 path; if that ever happens, the fallback becomes `hydrateRoot(document)` against the
same shell — the same page via React's mismatch recovery, at the cost of a console error.

### The Node adapter

`serve()` is `node:http` wrapped around the handler, for hosts that aren't fetch-shaped:

```ts
await serve({
    handler,
    staticDir: 'dist/client', // omit when a CDN serves the assets
    port: 3000,               // default: $PORT, or 3000
});
```

It serves files from `staticDir` with correct MIME types (a browser rejects a
`<script type="module">` served without a JavaScript type) and sends everything else to
the handler — so an unknown path is your app's 404 page, not this server's. It is
dependency-free and deliberately plain: no compression, no caching headers, no
clustering. Fine at this scale; put a CDN in front for real traffic.

`examples/ssr/serve.ts` is the whole thing in ~12 lines.

## The per-request lifecycle

The one rule everything above follows: **everything request-scoped is created inside
`createApp`, never at module level.** The server renders many requests in one process —
a module-level router, store, head store, or API client with a cookie jar is state
shared across users. Corollaries:

- One app instance per request; `renderApp` calls `router.dispose()` for you (release
  history listeners). If you drive the pieces yourself, dispose in a `finally`.
- Request context (auth, cookies, locale) enters through the stores you construct in
  `createApp`; scope loads read them via `hook()` as usual. There is no ambient request
  object — thread it through the factory.
- The head store is per-request for the same reason (see below) — `HeadProvider` with a
  module-global store would let concurrent requests overwrite each other's titles.

## The output is fully inline

Every route is a Suspense boundary, and past a byte budget React normally *outlines* a
completed one: the content goes into a hidden `<div>` at the end of the document and an
inline script swaps it over the loading slot. That trade exists so a streaming server can
flush a small shell before the slow boundaries resolve — rati never flushes early, so it
would be all cost: a reader without JavaScript (a crawler) would get "loading…" for the
page's real content, and the swap is also animation-frame-gated, so a backgrounded tab
wouldn't run it either. rati therefore renders with the budget out of reach: resolved
content always sits where you declared it, whatever the page weighs. Two exceptions stay
React's call — a boundary carrying hoisted stylesheets or suspensey images is outlined
regardless (it is coordinating the reveal with its own loads), and a boundary whose load
*failed* keeps its loading slot for the client to [retry](#response-statuses-and-load-failures).

Streaming is a non-goal rather than a missing flag: committing the status line at shell
flush and shipping `<head>` before in-Suspense `<Title>`s register is a different contract
from this one, not a knob on it. What it would take is written up in
[docs/research/ssr-streaming.md](../research/ssr-streaming.md) for a consumer that ever has
a real time-to-first-byte problem.

## Titles and meta

Declare the title (and per-page meta) from page content; the deepest live declaration
wins — a page beats a layout default, and during a client-side navigation the incoming
page beats the outgoing one:

```tsx
const head = createHeadStore({
    defaultTitle: 'MySite',                          // when no page declares one
    titleTemplate: (title) => `${title} · MySite`,   // wraps every declared title
});

// in a page — typically from resolved scope props:
<Title>{product.name}</Title>
<Meta name="description" content={product.summary} />
<Meta property="og:title" content={product.name} />

// hook form, tolerant of not-yet-loaded values (null declares nothing):
useTitle(page?.title);
```

On the client, `HeadProvider` keeps `document.title` and the managed `<meta>` tags in
sync — hydration and every navigation. On the server, declarations register during the
prerender (including inside a route's Suspense), and `renderApp` reads the winners into
`result.headTags` afterwards.

**On hydration, the server's head stands until the page speaks.** `HeadProvider` sits
above the routes' Suspense boundaries, so its first sync can run before the page that
declares the title has hydrated — a source-backed page, a `lazy()` chunk still in
flight, a large page React is still revealing. A document rati server-rendered therefore
stays the server's until a declaration is *removed* (a navigation, a conditional
declaration leaving): declared titles and metas land as they commit, but `defaultTitle`
is never written over the server's title, and server-rendered tags are never reconciled
away — their declarer may simply not have hydrated yet. rati recognizes a head it
server-rendered by the `data-rati-head="server"` marker `headTags` puts on every tag it
emits (the client sync marks its own tags `client`), so a client-only document never
looks server-rendered: it owns its head from the first sync and gets `defaultTitle`
immediately, with no need to repeat the default in `index.html`. A server that assembles
`<head>` by hand rather than from `headTags` (or `renderApp`) opts out of the guard —
the marker is the evidence.

**The dividing line: rati's head layer owns only tags that need dedupe.** React 19
hoists `<title>`/`<meta>`/`<link>` rendered anywhere into `<head>` natively — but it
does not dedupe them, and layered declarations are the normal case for titles and
descriptions. Everything else needs no rati API:

- Static, site-wide tags (charset, viewport, icons, verification): the HTML shell.
- Singleton tags a single component owns (`<link rel="canonical">`, preconnect):
  render the native tag in the component — React 19 hoists it, server and client.
- JSON-LD structured data: a plain `<script type="application/ld+json">` rendered in
  the page body — valid anywhere in the document, no head placement needed.

## Response statuses, and load failures

`result.status` derives from three signals, in order:

| Signal | Status | Meaning |
| --- | --- | --- |
| only the `*` catch-all matched (`result.matchedCatchAll`) | 404 | routing-level not-found |
| a load rejected with `NotAvailableError` | 404 | data-level not-found — the route matched, the entity doesn't exist |
| a load rejected with anything else | 500 | a real failure |
| otherwise | 200 | |

Throw `NotAvailableError` from a load when the requested thing doesn't exist — the same
error the error slot receives as `code: 'not-available'` on the client drives the 404
on the server.

**Without a `*` catch-all**, an unmatched URL is `kind: 'no-match'` instead, which
`createRequestHandler` answers with a plain-text 404 — no template, no client entry,
no styling. Add a catch-all route to keep your own not-found page; the status is 404
either way.

**What a failed load renders.** The error slot never renders on the server: React
abandons the failing Suspense boundary, emits the *loading* slot with a client-retry
marker, and the promise still resolves. On hydration the client re-runs that load — a
transient server hiccup heals itself, with no hydration mismatch; a persistent failure
reaches the error slot through the normal client path. Every failure is recorded in
`result.errors` (`{ mandalaId, key, error }` with the normalized `SourceError`), so a
different status policy than the table above is a few lines over that array.

An error *outside* every island — a render bug in the app shell, a route `wrapper` that
throws — rejects `renderApp` itself. `createRequestHandler` answers that with the
[CSR fallback](#when-a-render-throws); drive `render` yourself and it is yours to catch.

## Redirects

A route can declare itself a redirect:

```ts
// alias kept for old links (object target: resolved through the table,
// current search/hash preserved):
route('/settings', 'settings', () => null, {
    redirect: { to: { name: 'settings-profile' }, permanent: true },
}),

// legacy param path (function target: receives the matched params):
route('/old-posts/:slug', 'old-post', () => null, {
    redirect: { to: ({ slug }) => ({ name: 'post', slug }) },
}),
```

On the server this becomes `{ kind: 'redirect', to, permanent, status }` *before*
anything renders — a real 301/302. On the client the router follows it with a history
`replace`, so the redirecting URL never enters the back stack. Redirects to external
URLs stay at the HTTP layer (your server/CDN config), not in the route table.

**The target need not be a rati route.** A same-origin path that nothing in the table
matches — a static file, a legacy app, another SPA mounted elsewhere — is still a
redirect: the server answers the 30x and whatever owns that path serves it. (The
client follows the hop the same way, and the browser makes the request.) Through a
chain of hops, `to` is the last one's target and `permanent` is true only when every
hop declared itself permanent.

## The payload contract

`serializeHydration(state)` emits an **inert JSON script tag**
(`<script type="application/json" id="__rati-hydration">…</script>`), and
`readHydration()` parses it back. Properties worth knowing:

- It never executes: no `window.*` global, no inline-script CSP exemption needed, and
  no placement/ordering constraint — the client entry is a deferred module, so the tag
  is parsed wherever it sits. Before `</body>` is the convention.
- Values must survive JSON. A `Date`, `Map`, class instance, `undefined`, or `NaN`
  resolves fine on the server and arrives *different* on the client — outside
  production, `serializeHydration` warns per offending key.
- The payload carries a format version; a stale cached page meeting a newer client
  logs and falls back to resolving from scratch instead of misreading it.
- If the server and client render different trees, the registry keys (`useId`) shift
  and islands silently re-fetch — SSR quietly stops paying for itself. A client-side
  watchdog warns about payload slices no island claimed within a few seconds.

## Rolling your own server

Every layer is optional, and each one composes the one below it: `serve()` wraps
`createRequestHandler`, which wraps `render`, which is `renderApp` over the pieces
(`prepareRoute`, `renderToHtml`, `headTags`, `serializeHydration`). Drop down to any of
them. If you serve `render`'s result yourself, the notes are:

- **Two assembly patterns.** The template pattern (above): an `index.html` with
  `<!--app-head-->` / `<!--app-html-->` / `<!--app-state-->` placeholders, React
  rendering into `#root`. The whole-document pattern: React renders `<html>` itself
  and the client hydrates `document` — then splice `headTags`/`stateScript` into the
  HTML string (before `</head>` / `</body>`), *outside* the React tree, so React
  neither reconciles nor duplicates them during hydration.
- **Serve static assets with correct MIME types** — a browser rejects a
  `<script type="module">` served without a JavaScript `Content-Type`.
- **No manifest reading, no asset splicing.** The built server entry carries its own
  hashed tags ([`virtual:rati/assets`](#build)), so a server never looks at
  `dist/client/.vite/`. If you don't build through the plugin, pass `renderApp` a
  `RenderAssets` of your own — it is three optional fields.
- **Dev needs nothing here.** The [plugin](#the-vite-plugin) owns it, so anything you
  write is production-only code, with no dev branch to keep honest.
