# RSC support — what `@vitejs/plugin-rsc` gives us, what rati must add

Status: research only (2026-07-15), out of the SSR-11/streaming discussion. Extends
the direction note in
`docs/research/directions-2026-07/improvements.md` §6 (dissolved) from
"keep the door open" to a concrete map. Maintainer's questions: there is already a
Vite plugin for RSC — will it work, and what does rati need to add?

## The plugin, verified (July 2026)

`@vitejs/plugin-rsc` — formerly `@hiogawa/vite-rsc`, now in the official vitejs org
([vite-plugin-react monorepo](https://github.com/vitejs/vite-plugin-react/tree/main/packages/plugin-rsc)),
v0.5.27, **experimental pre-1.0** (downstreams warn of breaking changes in
minor/patch). It is explicitly framework-agnostic and designed to be wrapped — Waku
migrated its whole RSC bundler onto it, React Router's RSC preview
(`unstable_reactRouterRSC`) and RedwoodSDK are thin wrapper plugins over it. Facts
that shape rati's answer:

- **It owns three environments, by name — `rsc`, `ssr`, `client`** — and a mandatory
  multi-pass build (`rsc scan → ssr scan → rsc → client → ssr`; reference maps from
  the scan passes feed the later ones). A host plugin layers *above* it (wrapper
  ordered before `rsc()` in `plugins`), it does not orchestrate beside it.
- **It owns the hard transforms**: `'use client'`/`'use server'` boundaries and
  reference maps, `server-only`/`client-only` import validation, CSS injection at
  server-component boundaries, closure-argument encryption for inline actions.
- **The framework writes three entries** (the starter shape): `entry.rsc` (request →
  flight stream via the plugin's `renderToReadableStream`, action decoding, response
  status), `entry.ssr` (flight → HTML via `react-dom/server.edge`, with the
  `rsc-html-stream` `injectRSCPayload` pattern embedding the flight payload in the
  HTML), `entry.browser` (read the injected payload, `hydrateRoot(document, root)`,
  `setServerCallback` for actions). Cross-env plumbing is the plugin's
  (`import.meta.viteRsc.loadModule/loadCss/loadBootstrapScriptContent`).
- **Flight runtime**: it vendors `react-server-dom-webpack` (there is no
  `react-server-dom-vite`) and layers Vite-flavored module references on top.
  React 19+ required; exact 19.2.x patch compatibility has been version-sensitive
  (React Router issue #14633 — rati is on 19.2.7, so pin-testing is mandatory).
- **Status codes and head are the framework's** — the plugin has no meta abstraction
  and the `Response` is yours; the starter's error path sets 500 + a no-hydrate flag
  that swaps `hydrateRoot` for a fresh `createRoot` CSR replay (note: RSC's whole
  answer to SSR-12's fallback question, for free, because the root is a flight
  payload rather than a component the client can't mount).

## Will it work with rati? — yes, as a sibling mode, not an evolution

The composition verdict is clean but strict: **`ratiSsr` and `plugin-rsc` cannot run
together.** `ratiSsr` configures the `client`+`ssr` environments, opts into the
builder, and owns `buildApp` ordering (client → ssr, manifest handoff); `plugin-rsc`
owns those same environment names plus `rsc` and its own five-pass ordering. Two
multi-env orchestrators in one config is exactly the conflict its downstreams avoid
by wrapping. So RSC support is a **separate `ratiRsc()` wrapper plugin + its own
three entries** — a second face of the kit beside `ratiSsr`, sharing rati's routing
and scope layers but not the SSR machinery (`prerender`, the hydration payload, the
collector, the manifest/assets module — the plugin replaces every one of those
jobs). An app picks one plugin; nothing migrates implicitly.

## What rati must add (the framework half)

1. **The three entries, shipped as library code** — the `renderApp`-equivalent for
   RSC: request → route match → flight, flight → HTML, hydrate + navigate. rati's
   existing pieces slot in: `RouterStore` + memory history already do server-side
   matching DOM-free, and status derivation stays rati's (the plugin leaves the
   `Response` to us — the ssr-streaming.md analysis applies verbatim, because flight
   SSR *is* streaming SSR: data-driven 404/500 needs a block-the-shell line, and the
   scope-levels-as-shell-line idea carries over unchanged).
2. **The island's server variant** — the conceptual heart. Today an island resolves
   its scope client-side (or under `prerender` with dehydration). Under RSC an
   island becomes a *server component* that awaits the scope's levels and renders
   the `'use client'` component with fully-resolved props. This is rati's design
   intent meeting its natural runtime: "components receive clean, fully-resolved
   props" is RSC's model exactly, the typed waterfall is what the server component
   awaits, and flight serialization replaces the hydration payload (no collector, no
   watchdog, no JSON-survival caveats — flight handles more types and streams
   per-boundary). `hook()` and `source` loads stay client-side, which the existing
   load/hook split already expresses.
3. **Client navigation as flight refetch** — the biggest genuinely new machinery.
   Today `Link` navigation re-resolves scopes in the browser; under RSC the loads
   live in server-only modules, so navigation must fetch the new URL's flight
   payload (the `.rsc` convention) and swap the root in a transition. Router state,
   scroll restoration, and `navTrace` need to interoperate with that loop.
4. **Package slicing for the `react-server` condition.** The `rsc` environment loads
   modules with the `react-server` condition, where React has no client hooks —
   importing rati's barrel (which pulls `useSyncExternalStore` et al.) would break.
   rati needs its client-runtime modules marked `'use client'` (shipped in dist, so
   the plugin turns them into references) and a server-safe surface (scope/route
   spec builders, which are already plain values) importable under the condition.
   This is improvements.md §6's "keep scope modules importable in server-only
   contexts" habit turned into a package requirement.
5. **Head under RSC.** `useHeadTag` is client-hook-based (`useId`/`useEffect`/
   context), so `<Title>`/`<Meta>` remain client components — they run in the `ssr`
   environment's HTML pass (context works there), so the read-back still functions
   for buffered HTML; under streamed HTML they hit the shell-time limits already
   recorded in [ssr-streaming.md](docs/research/undecided/ssr-streaming.md). An RSC-native alternative
   (titles rendered directly in the server tree, since the root owns the whole
   document) is simpler but loses dedupe-by-depth — a design pass owns that
   trade-off.
6. **Server actions** are optional but land on rati's open mutation question — the
   plugin provides the transform + encode/decode primitives, the framework routes
   the call and re-renders. If rati ever wants them, they belong to the
   [data-package](docs/archive/directions-2026-07/data-package.md) mutation design, not the SSR
   kit.

## Verdict

The plugin works and is the right substrate — wrapping it is the proven pattern, and
rati's scope/island model maps onto RSC unusually well (better than hook-style data
loading does: the waterfall is already declarative, typed, and server-shaped). The
cost is real framework work concentrated in items 2–4, and the substrate is
experimental: 0.5.x with breaking patch releases and React-patch sensitivity. No
current consumer needs it (Jnana doesn't even need SSR; nazar's pages are static-ish
data). Recommendation: keep the §6 compatibility habits plus item 4's packaging
awareness in current work, and revisit when the plugin hits 1.0 or a consumer wants
server-only data access (secrets, direct DB) that the dehydration model can't offer.
A spike (the starter's three entries + one rati scope hand-wired as a server island)
would de-risk items 2 and 4 in a day and is the natural first move when this
reopens.
