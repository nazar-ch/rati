# rati

rati is a small, custom TypeScript frontend framework for **React**, built and evolved alongside Jnana to serve its needs — prioritizing simplicity, end-to-end type safety, and developer experience. Jnana consumes rati's source directly (via the `rati-dev` export condition) and drives its design.

Yarn-workspaces monorepo: `packages/rati` (the published `rati` package) plus `examples/{demo,ssr}` (dev/test apps). Workspace names: `rati`, `demo`, `ssr-demo`.

This is the whole of what a session in this checkout is handed before it opens anything. Everything else is read on demand: the memory topics at the end, the canonical stations under docs/current/, and the effort and finding records under docs/planned/ and docs/backlog/.

## Canonical docs — read these first

The stations, and the source of truth for what each covers.

- docs/current/public/ — the **guide** + **reference**: the public API and mental model, app setup, routing, SSR, rendered by the website.
- docs/current/internals.md — contributor internals: source layout, the `mandala` engine, the resolver/refresh machinery, lifecycle/teardown, channels, SSR dehydration, testing, toolchain.
- docs/research/ — deferred features, design directions, testing strategy.
- docs/planned/ — committed efforts: an effort `README.md` (framing, decisions, narrative item map), an optional `plan.md` (batches + grading), and one work-item record per item under `issues/<ID>-<slug>.md`.
- docs/current/RELEASING.md — the release process.
- docs/planned/website/website-plan.md — the public site.
- New public surface documents in docs/current/public/ and nowhere else — that tree is what the website renders.

## Mental model

A **scope** declares *which data go where* (inputs via `input<T>()`, then `.load({…})` levels resolved as a visible waterfall). An **island** mounts a scope — pairs it with a component plus loading/error slots, resolves the data, and provides the resolved props to its subtree. A **route** is an island bound to a URL. Components receive clean, fully-resolved props — no loading-state juggling.

```
scope({ inputs }).load({ data }).provide(factory?)   →  a Scope (a plain value)
island({ scope, component, loading, error })         →  a component
route(path, name, component, { scope, … })           →  the same, on a URL
useScope(scope)                                       →  read what it provides, below
```

Design intent (the "why"): the author dislikes hook-style data loading (react-query/SWR) that makes components manage loading states and re-declare types. rati resolves declarative typed specs into fully-loaded props, with types inferred end-to-end from backend types. Resolution is all-or-nothing — a half-resolved bag is incoherent. Naming is deliberately plain English mapped to concepts React devs already know. **Never coin a new term** in the public API — the internal engine name `mandala` is the lone exception, and stays internal, so callers only ever see `island`/`route`.
