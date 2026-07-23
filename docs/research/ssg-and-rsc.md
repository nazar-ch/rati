# SSR → SSG & RSC — direction note

Direction only, **deliberately not designed** and not built — Jnana needs neither (it is
fully interactive and doesn't even need SSR). These ride on the `examples/ssr` gallery until
a real consumer exists. The SSR *baseline* underneath them shipped in 2026-07 (the server
kit — `renderApp`, `rati/vite`, `rati/server`; see the archived
[ssr-server-kit.md](docs/archive/directions-2026-07/ssr-server-kit.md) and
[ssr-nazar-patterns.md](docs/archive/directions-2026-07/ssr-nazar-patterns.md), and
[docs/current/public/ssr.md](docs/current/public/ssr.md)); this note is what sits beyond it.

## SSG — the near step

Mostly a build script over existing pieces: enumerate static routes (paths without params,
plus enumerated param values), run `renderApp` per URL (the 2026-07 SSR baseline shipped it —
one call returning html + status + headTags + the versioned payload tag, deliberately the SSG
per-URL loop), and write the files. Remaining framework work: a route-table walker
(`staticPaths` per param route). The existing consequence "server data must be an async load;
sources stay pending under SSR" carries over unchanged. SSG still needs its own design pass
before commitment.

The hydration-payload shape the SSG direction wants ("a stable, versioned dehydration format")
is already what shipped — `serializeHydration` emits a versioned (`v: 1`) inert JSON tag.

## RSC — a compatibility constraint, not a feature

RSC maps naturally in principle — a scope's promise-load waterfall is exactly what a server
component resolves, and the `hook()`/source loads are exactly what stays client — but adopting
it means a bundler/runtime contract far beyond rati's current size. Treat it as a
compatibility constraint, not a feature: keep scope modules importable in server-only contexts
(no DOM at module scope), keep promise-load results serializable, keep the load/hook split
crisp. Those habits cost nothing now and keep the door open.

The bundler/runtime contract now exists off the shelf (`@vitejs/plugin-rsc`); what rati would
add, and when to revisit, is worked out in the postponed record
[postponed/rsc-support.md](postponed/rsc-support.md). The island-SSR dehydration decision
that bears on it (keep the framework-owned registry until a deliberate RSC adoption) is the
archived [island-ssr-dehydration.md](docs/archive/island-ssr-dehydration.md).

## The non-goal this backstops

Streaming SSR stays out (`prerender` is all-or-nothing). The per-island `ssr: false` option
([scope-and-island-directions.md](scope-and-island-directions.md) §2) is the sanctioned
pressure valve for below-the-fold / expensive / personalized islands; full streaming is a
deliberate RSC adoption with its own plan, not a rider on the resolver.
