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
load. There is no rati server — you bring a ~50-line HTTP server (or a serverless
function) and call one function per request.

## The server entry

`renderApp` runs the whole per-request loop — memory history → a fresh app →
route matching → prerender → dispose — and returns a decision object:

```tsx
// entry-server.tsx
import { renderApp, type RenderAppResult } from 'rati/ssr';
import { createApp } from './createApp';

export function render(url: string): Promise<RenderAppResult> {
    return renderApp({ url, createApp });
}
```

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

The result is one of three kinds; the server maps them onto the response:

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
    .replace('<!--app-head-->', result.headTags)     // <title> + <meta> winners
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
import { hydrateRoot } from 'react-dom/client';
import { readHydration } from 'rati/ssr';
import { createBrowserHistory } from 'rati';
import { createApp } from './createApp';

const state = readHydration(); // null → client-only boot, resolve from scratch

const { App } = createApp({
    history: createBrowserHistory(),
    hydratedState: state?.router,
    hydration: state ? { data: state.data, seeds: state.seeds } : undefined,
});

hydrateRoot(document.getElementById('root')!, <App />);
```

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

**What a failed load renders.** The error slot never renders on the server: React
abandons the failing Suspense boundary, emits the *loading* slot with a client-retry
marker, and the promise still resolves. On hydration the client re-runs that load — a
transient server hiccup heals itself, with no hydration mismatch; a persistent failure
reaches the error slot through the normal client path. Every failure is recorded in
`result.errors` (`{ mandalaId, key, error }` with the normalized `SourceError`), so a
different status policy than the table above is a few lines over that array.

An error *outside* every island — a render bug in the app shell — rejects `renderApp`
itself; catch it and serve your 500 page (or the client-only shell as a fallback).

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

## Bring-your-own-server notes

- **Two assembly patterns.** The template pattern (above): an `index.html` with
  `<!--app-head-->` / `<!--app-html-->` / `<!--app-state-->` placeholders, React
  rendering into `#root`. The whole-document pattern: React renders `<html>` itself
  and the client hydrates `document` — then splice `headTags`/`stateScript` into the
  HTML string (before `</head>` / `</body>`), *outside* the React tree, so React
  neither reconciles nor duplicates them during hydration.
- **Serve static assets with correct MIME types** — a browser rejects a
  `<script type="module">` served without a JavaScript `Content-Type`.
- The dev-vs-prod plumbing (Vite middleware mode + `ssrLoadModule`, manifest-derived
  asset tags in prod) is the same for every app — `examples/ssr`'s `server.ts` is the
  reference implementation to copy until rati ships a packaged server kit.
