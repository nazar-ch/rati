# SSR patterns from nazar.ch — what's worth absorbing

nazar.ch (`~/Sites/nazar.ch/site`) is the first real rati SSR consumer outside the
`examples/ssr` gallery: a whole-document-rendered site (React owns `<html>`), served by a
hand-written Node server in dev and a Vercel serverless function in prod. Reviewed:
`server.ts`, `api/ssr.ts`, `src/entry-server.tsx`, `src/entry-client.tsx`,
`src/createApp.tsx`, `src/head.tsx`. Everything it had to hand-roll around rati is a
candidate for rati; ranked by how framework-shaped the hand-rolled piece is.

(It is on the pre-rename surface — `WebRouterStore`, `IslandHydrationProvider`, all from
the main barrel. Migrating it is the first real-world test of the rename diff; noted as a
task, not a design item.)

## 1. Document title management — adopt

rati has no head API, so nazar built one (`src/head.tsx`): a `HeadStore` + `<Title>` +
`TitleManager`, ~120 lines whose comments record three correctness constraints discovered
the hard way:

- **A React-rendered `<title>` doesn't work.** rati wraps every route in Suspense, so a
  page's `<Title>` registers *during* the prerender's Suspense resolution — anything that
  reads the title as a React element renders before the page has spoken. And a
  React-rendered `<title>` can fail to claim the server-injected node during hydration,
  duplicating it. So: register into a store during render, read the winner *after*
  `prerender` on the server, drive `document.title` from an effect on the client.
- **One store per render tree, never a module global** — concurrent SSR requests would
  clobber each other's titles.
- **Dedupe by registration order** (a seq counter): several `<Title>`s are live at once
  (layout default + page, or old + new page mid-navigation); last registered = deepest =
  wins. Idempotent per `useId` so StrictMode double-renders don't advance the seq.

Every SSR consumer needs a title; none should have to rediscover those constraints. The
store is small, MobX-free, and already shaped like rati code. Option: absorb it as a
`<Title>` component + `HeadProvider` in core (it renders on the client too) with the
server read-back (`getTitle()` after prerender) documented via `rati/ssr`. Deliberately
title-only — meta/OG tags wait for a real need (nazar injects those statically), and a
full head manager is a bigger commitment. Naming is plain English already: `Title`,
`HeadProvider`.

## 2. One hydration payload + safe serialization — adopt

rati hands the server *two* payloads (the router's `hydratedState`, the collector's island
`data`) and leaves the rest to the app. nazar therefore:

- defines `AppHydrationState { router, islands }` and a `window.__RATI_STATE__` global;
- implements `escapeJsonForScript` — escaping `<`, `>`, `&`, U+2028, U+2029 so the JSON
  survives inside a `<script>` tag — **twice** (`server.ts` and `api/ssr.ts`), the one
  security-sensitive piece of the whole setup;
- splices the state script before `</body>` (a comment explains the ordering contract:
  inline classic script runs at parse time, before the deferred module entry hydrates).

`rati/ssr` should own this: a combined state type, `serializeHydration(state)` returning
the escaped `<script>` tag (name TBD), and a client-side `readHydration()` for the
window global. Cheap to build, removes duplicated XSS-escaping from every consumer, and
standardizes the payload shape — which the SSG direction
([improvements.md §6](./improvements.md)) independently wants ("a stable, versioned
dehydration format").

## 3. `prerender`-to-string helper — adopt (small)

Every server entry re-writes the same ReadableStream drain loop over `react-dom/static`
`prerender` (nazar's `prerenderToString`; `examples/ssr` has its sibling). A
`renderToHtml(element, { bootstrapModules })` in `rati/ssr` — thin, `react-dom/static`
stays a peer import — ends that. Together with §2 a minimal server entry becomes
`prepareRoute` → `renderToHtml` → `serializeHydration`, which is also exactly the loop an
SSG build script runs per URL.

## 4. Match status for HTTP codes — adopt (tiny)

nazar derives the response status from a route-name convention
(`activeRouteName === 'notFound'` → 404) — brittle, and every server will need it.
`prepareRoute` already knows whether only the `*` catch-all matched; expose it on
`PreparedRoute` (e.g. `matchedCatchAll: boolean`, letting the app map it to a status).

## 5. Server-side redirects — adopt (maintainer-confirmed)

`Navigate` is client-only. nazar's one redirect (`/talk` → Calendly) is *external* and
handled at the HTTP layer — the right place for it. But an internal redirect route
(`route('/settings', …, () => <Navigate to="…"/>)`, as in the demo app) would today
SSR the pre-redirect page and hop on the client. The honest fix is a route-level
`redirectTo` option that `prepareRoute` reports (so the server can 30x before rendering)
and that the client router honors like a `<Navigate>` — not sniffing `<Navigate>` out of
a render. External URLs stay at the HTTP layer. Confirmed for the public-prep batch
(CORE-6 in [public-prep-tasks.md](../../public-prep-tasks.md)).

## 6. Example & docs fixes that fall out

- `examples/ssr`'s static file serving omits `Content-Type` — nazar's server comments call
  it out (a browser rejects a `<script type="module">` without a JS MIME type). Fix the
  example.
- Document the whole-document pattern in the SSR docs: React rendering `<html>` and the
  client hydrating `document` (not a `#root` div), with injected tags (state script,
  analytics, hashed CSS links) kept *outside* the React tree so React 19 doesn't re-hoist
  or duplicate them during hydration.
- Document the per-request lifecycle explicitly: fresh `RouterStore` + collector per
  request, `router.dispose()` after render (nazar does this correctly; the docs never say
  to).
