# SSR-01 — rati/vite plugin: dev serving without a user server

area: packages/rati/src/vite (new), examples/ssr
needs: —
disposition: —

## Problem

Every SSR consumer hand-rolls the same dev server: Vite in middleware mode, a piping
dance between the Node listener and Vite's connect middleware, `ssrLoadModule` of the
server entry, `transformIndexHtml`, `ssrFixStacktrace`. Design:
[ssr-server-kit.md](docs/archive/directions-2026-07/ssr-server-kit.md) §Layer 2
(read first — the entry contract, placeholder conventions, and anti-bloat lines are
specified there).

## Scope

1. A new `rati/vite` entry exporting the plugin (working name `ratiSsr()`); `vite`
   added as an optional peer dependency. The plugin's dev half only:
   `configureServer` installs a catch-all HTML middleware that loads the app's server
   entry (default `/src/entry-server.tsx`, option to override), calls its exported
   `render(url): Promise<RenderAppResult>`, maps result kinds onto the response
   (redirect → 30x, no-match → 404, rendered → template assembly with the
   `<!--app-head-->`/`<!--app-html-->`/`<!--app-state-->` placeholders +
   `transformIndexHtml`), and routes errors through `ssrFixStacktrace` + the overlay.
2. Whole-document support: when `result.html` starts with `<!doctype`/`<html`, splice
   head/state into the document string instead of using a template.
3. Server-entry watching → full reload (the entry graph is not HMR-safe).
4. `examples/ssr` runs dev via `vite dev` with the plugin; its `server.ts` keeps only
   the prod path (deleted fully in SSR-03).

## Boundaries

- Dev only — no build orchestration (SSR-02), no prod handler (SSR-03).
- The Layer-1 contract is frozen: the plugin consumes `RenderAppResult`; do not add
  plugin-specific fields to it.
- Option surface minimal: entry path, template path, placeholder names. Anything more
  waits for the B2-exit review.

## Verify

`vp run rati#test` + a plugin test (Vite `createServer` programmatically, request `/`,
assert assembled HTML + status). Manually: `vite dev` in `examples/ssr` serves all
gallery pages with HMR alive; `/store/2` → 301; `/products/9` → 404.
