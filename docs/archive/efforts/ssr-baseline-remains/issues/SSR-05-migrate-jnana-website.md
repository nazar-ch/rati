---
area: ~/Sites/jnana/website (external repo; frontend + server workspaces)
needs: SSR-03 (kit path; see Boundaries for the baseline-only variant), a rati release
status: done
disposition: —
---

# SSR-05 — migrate the jnana website onto the released SSR surface

## Problem

The jnana website hand-rolls the template-pattern SSR shell: its own
`escapeJsonForScript`, stream drain, `RenderResult` type, `activeRouteName ===
'notFound'` status mapping, and the Hono/Vite middleware piping in
`website/server/src/ssr.ts`. It has no head management (static template title only) —
as a marketing site it wants per-route title/description/OG.

## Scope

1. `website/frontend`: entry-server → `renderApp`; entry-client → `readHydration`;
   template placeholders (`<!--app-head-->` joins the existing two); delete
   `render-result.ts` in favor of `RenderAppResult`.
2. Head: per-request `createHeadStore` in `create-app.tsx`, `<Title>`/`<Meta>` on the
   pages (landing description/OG at minimum).
3. `website/server`: Hono routes consume the kit's fetch handler
   (`app.all('*', (c) => handler(c.req.raw))`); the Vite-middleware piping and
   `escape-json.ts` go away in dev via the plugin.
4. Status codes from the result, not the route-name convention.

## Boundaries

- jnana repo conventions apply there (branch/PR workflow, its verify gate) — this
  record only carries the rati-facing scope.
- **Baseline-only variant** (if B2 stalls): steps 1/2/4 with the existing Hono shell
  kept, `escape-json.ts` still deleted (payload comes from `serializeHydration`).

## Verify

`vp run website#typecheck` + the website's build; local dev serve: view-source
title/meta/payload, 404 on unknown paths, hydration console-clean.
