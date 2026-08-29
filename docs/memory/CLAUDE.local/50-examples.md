## Examples — current status

`examples/demo` and `examples/ssr` are on the current `scope`/`island`/`route` API and both typecheck, build, and lint — so `vp lint` is green repo-wide (the `rati` package emits only the intentional type-machinery warnings). `demo` is a client-only SPA showing plain route components, route params, and `scope().load(…)` waterfalls (incl. a store class).

`ssr` is a server-rendered **feature gallery** — a page per concept (async loads + dehydration, an `input`→`hook`→dependent waterfall, the `useRouteContext` value channel, a MobX store as a class load, a `Source`-backed live clock, an error-slot + `retry`, a `lazy()` route whose chunk the built page preloads, and a route whose `wrapper` throws on the server to show the CSR fallback), each foregrounding its server/client behavior.

It has no server and no build script of its own: `rati/vite` runs dev and both build environments (`vp dev` / `vp build`), so `index.html` is a plain shell — no `<script>`, no build input — and `serve.ts` is ~12 lines over `rati/server` (`vp run ssr-demo#start`, after `vp run rati#build` — plain node resolves the published entry, not the `rati-dev` source condition).

The mechanism the gallery leans on — `prerender` over `renderToString`, dehydration through the `rati/ssr` entry, and what that demands of a load or a `Source` — is docs/current/internals.md §SSR dehydration.
