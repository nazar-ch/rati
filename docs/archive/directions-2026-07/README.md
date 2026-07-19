# Design review & directions — July 2026 (archived)

A framework-design pass over rati and its consumer Jnana (`~/Sites/jnana`), done while renames
and API changes were still cheap (no external users). **Archived**: the review's recommendations
were largely executed — this folder keeps the documents whose subject shipped. The options that
did *not* ship were regrouped by topic into [../../research/](../../research/) (see the pointers
below); nothing here is a live to-do.

## What was reviewed

- rati: the public surface (`main.ts`), scope/mandala/source internals, the router, the
  legacy `data/` layer (`remoteData`, `ActiveData`, `apiUtils`), `stores/`
  (`RootStore`/`GlobalStore`), and the existing research docs.
- Jnana: `routes.tsx` (pages as routes), `pageScope` / `blockContentScope` +
  `BlockContent` (blocks as islands), the `FetchStore` family, `JnanaList.reconcileItems`,
  `ResourceContainer` / `ResourcePool`, and the `GlobalStoresContainer` / `useStores` /
  `LoginPage` import-cycle workarounds.

## The documents (shipped → archived here)

- [naming.md](./naming.md) — the public-API name review. **Shipped**: `prop`→`input` (and
  `ScopeParams`→`ScopeInputs`), `WebRouterStore`→`RouterStore`, `useWebRouter`→`useRouter`, the
  `Island*` hydration surface moved to a `rati/ssr` entry, `sleep` off the public barrel. Not
  adopted: `useRouteContext`→`useRouteScope` (kept), and the stores-cluster §6 renames (carried
  forward — see below).
- [data-package.md](./data-package.md) — the companion `rati/data` package. **Shipped**
  2026-07-18: `query` / `collection` / `pagedCollection` / `mutation` / `form` / `field` + the
  validator kit; the legacy `data/` layer and its decorator toolchain were dropped the same day.
  `reactive:` params were deferred; the remaining items (reactive params, guide coverage,
  consumer migrations, extraction) live in [../../planned/data-package/](../../planned/data-package/).
  This is still the design record the `rati/data` source cites.
- [mandala-refresh-and-ssr-sources.md](./mandala-refresh-and-ssr-sources.md) — **shipped**:
  selective scope refresh (`useScopeControls`, the `data()` load marker, read-set cascades) and
  SSR-capable sources (the `Source.ssr` marker, loader vs live-seeded hydration).
- [ssr-nazar-patterns.md](./ssr-nazar-patterns.md) — what nazar.ch had to hand-roll, **absorbed**:
  the head API (`Title`/`Meta`/`HeadProvider`/`useTitle`), one safe hydration payload
  (`serializeHydration`/`readHydration`), the `renderToHtml`/`renderApp` helpers, match-status for
  HTTP codes, server-side redirects (`route(…, { redirect })`).
- [ssr-server-kit.md](./ssr-server-kit.md) — Layers 2/3 of the SSR kit, **shipped**: the
  `rati/vite` plugin (dev serving + two-environment build + `virtual:rati/assets` + lazy-route
  modulepreload) and `rati/server` (`createRequestHandler` + `serve`), including the
  whole-document fallback.

Two related decisions, archived one level up: [../island-ssr-dehydration.md](../island-ssr-dehydration.md)
(keep the framework-owned dehydration registry until a deliberate RSC adoption) and
[../mandala-testing.md](../mandala-testing.md) (the mandala testing strategy — altitude rule,
deterministic pins, the fuzz foundation — now executed as the
[../../planned/mandala-fuzz/](../../planned/mandala-fuzz/) effort).

## Open options that did not ship → regrouped into research

- `improvements.md` (dissolved) — its open options became
  [scope-and-island-directions.md](../../research/scope-and-island-directions.md) (abort signals,
  `loadingDelayMs`, `keepStale`, retry policy, per-island `ssr: false`, SSR-error dehydration,
  `ResourceContainer`), the router items in
  [router-extensions.md](../../research/router-extensions.md) (typed search params, navigation
  status/blocking), [ssg-and-rsc.md](../../research/ssg-and-rsc.md), and
  [dx-and-tooling.md](../../research/dx-and-tooling.md). Its two shipped items — "scope refresh
  from below" (= `useScopeControls`) and the SSR-error baseline — are recorded in the
  mandala-refresh and nazar-patterns docs above.
- The stores container restructuring (naming §6 + the router-decoupling shape change) did **not**
  ship and stays open: [stores-and-router.md](../../research/stores-and-router.md) (assessment) and
  [stores-container-implementation.md](../../research/stores-container-implementation.md) (the
  Option A plan).

## Standing constraints (from the project's design intent)

- Plain-English naming mapped to concepts React devs already know; no coined terms in the
  public API (`mandala` stays internal).
- Resolution is all-or-nothing; components receive clean, fully-resolved props.
- Features wait for a real (Jnana-driven) need; speculative items are noted, not designed.
- Core stays MobX-free; MobX is fine in the companion data package.
