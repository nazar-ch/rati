# SSR-02 — rati/vite plugin: build orchestration, assets module, modulepreload

area: packages/rati/src/vite, examples/ssr
needs: SSR-01
disposition: —

## Problem

Prod consumers read the client manifest by hand to emit the hashed entry script and CSS
links (nazar's Vercel function additionally fights serverless path resolution), and
lazy routes ship no `modulepreload` — the client hydrates, then waterfalls on the route
chunk. Design: [ssr-server-kit.md](docs/archive/directions-2026-07/ssr-server-kit.md)
§Layer 2 (build half).

## Scope

1. Build orchestration via the Vite environments API: one `vite build` produces
   `dist/client` (with manifest) and `dist/server`.
2. The `virtual:rati/assets` module: `{ bootstrapModules, styleTags }` — manifest-derived
   in prod, `/src/entry-client.tsx` + empty in dev. Server entries import it instead of
   reading manifests.
3. Lazy-route preload: the specifier-recording transform on `lazy()` call sites (or,
   if that fights the bundler, the explicit `routeChunks` map fallback — the design doc
   allows either; record which and why), exposed as `preloadTagsFor(routeName)` on the
   assets module.
4. `examples/ssr` builds through the plugin; its manifest-reading code deleted.

## Boundaries

- No prod request handling (SSR-03).
- The preload mechanism must not change `lazy()`'s runtime behavior for non-plugin
  consumers; the transform is additive metadata only.
- If the environments-API orchestration turns out to fight vite-plus pinning, fall back
  to documented two-command builds (as today) and keep the assets module — note the
  decision at the checkpoint rather than forcing it.

## Verify

Example prod build: `dist/client` assets referenced by hash in the served HTML,
CSS links present, navigating to a lazy route's URL emits its modulepreload tag.
Plugin-level test for the assets module resolution in both modes.
