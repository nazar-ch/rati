# Gap analysis against the field

Status: research record (2026-07-20), the output of the improvement-review effort's
[IMP-01 session](docs/planned/improvement-review/issues/IMP-01-field-gap-analysis.md).
For each neighboring framework: what its users lean on daily, checked against its current
docs this session, classified through rati's stance. Unflattering findings are the point —
this is an internal engineering gap list, not a marketing comparison.

Versions checked (2026-07-20; each claim below links the doc it was read from):

| Neighbor | Version at session time |
| --- | --- |
| TanStack Query (react-query) | `@tanstack/react-query@5.101.2`, v5 docs |
| SWR | `swr@2.4.2`, v2 docs |
| TanStack Router / Start | `@tanstack/react-router@1.170.18`; Start `1.168.28` (RC) |
| React Router | v8.2.0 (v8 shipped 2026-06-17; "Remix v3" became RR v7 framework mode, the Remix brand pivoted to a non-React rebuild) |
| Next.js | 16.2.10 (App Router; implicit fetch caching removed in 16, caching is opt-in via `use cache` / Cache Components) |

## How to read this — the filter

rati's model *replaces* hook-style loading: components receive resolved props, resolution
is all-or-nothing, loads are cached per island instance, and there is deliberately no
global request cache ("What rati is not", [guide.md](docs/current/public/guide.md)). So a
missing feature is not automatically a gap. Every field feature below is classified:

- **(a) covered differently** — the model answers it; the mapping is written down here
  (documentation fuel, even though writing user docs is out of this session's scope).
- **(b) deliberately out** — rejected or out of rati's lane, with the reasoning.
- **(c) recorded and waiting** — an existing research record owns it; cited, never
  re-proposed. Where the field moved since the record was written, the new evidence is
  noted on the citation.
- **(d) net-new gap** — nobody had noticed it; a proposal below.

`src/data/` territory (query caching, mutations, forms) is excluded from *proposing* by
the effort's boundary; gaps landing there are collected in
[§Notes filed to the data effort](#notes-filed-to-the-data-effort).

---

## 1. Declaring and loading data

| Field feature | rati today | Class |
| --- | --- | --- |
| [Dependent queries via `enabled`](https://tanstack.com/query/latest/docs/framework/react/guides/dependent-queries) (TQ v5); [conditional fetching](https://swr.vercel.app/docs/conditional-fetching) (SWR 2) | `.load()` levels — the dependency is the declaration | (a) |
| [Parallel queries / `useQueries`](https://tanstack.com/query/latest/docs/framework/react/guides/parallel-queries) (TQ v5) | keys within one level resolve in parallel | (a) |
| [Route loaders](https://tanstack.com/router/latest/docs/framework/react/guide/data-loading) (TSR 1.170); [`loader`/`clientLoader`](https://reactrouter.com/start/framework/data-loading) (RR 8) | `route(..., { scope })` — the scope is the loader | (a) |
| [Suspense hooks](https://tanstack.com/query/latest/docs/framework/react/guides/suspense) (TQ v5, `useSuspenseQuery`); [SWR `suspense: true`](https://swr.vercel.app/docs/suspense) | the engine *is* Suspense; non-`undefined` data is the default, not the opt-in | (a) |
| [`AbortSignal` to every `queryFn`](https://tanstack.com/query/latest/docs/framework/react/guides/query-cancellation) (TQ v5) | `LoadContext.signal` (SI-01). Note TQ's cancellation [does not work with its suspense hooks](https://tanstack.com/query/latest/docs/framework/react/guides/suspense); rati's does | (a) |
| [`select` / derived data](https://tanstack.com/query/latest/docs/framework/react/guides/render-optimizations) (TQ v5) | a dependent load *is* the derivation, typed | (a) |
| [Deferred data: promises from loaders + `<Await>`](https://tanstack.com/router/latest/docs/framework/react/guide/deferred-data-loading) (TSR 1.170); [RR streaming with Suspense](https://reactrouter.com/how-to/suspense) (RR 8, `defer()` replaced by raw promises) | all-or-nothing by design; the per-prop escape is the designed-but-unbuilt `.live()` | (c) — [undecided/deferred-scope-features.md](undecided/deferred-scope-features.md) |
| Free dependency graphs (finer than levels) | depth-layered chain is the typeable normal form; `derive()` sketched | (c) — [undecided/dependency-graphs.md](undecided/dependency-graphs.md) |
| [`initialData` / `placeholderData`](https://tanstack.com/query/latest/docs/framework/react/guides/placeholder-query-data) (TQ v5); [SWR `fallbackData`](https://swr.vercel.app/docs/global-configuration) | see prose below | (a)/(b) |

**The waterfall tension, worth saying plainly.** TanStack Query's docs call the `enabled`
chain [a request waterfall that hurts performance](https://tanstack.com/query/latest/docs/framework/react/guides/dependent-queries)
and push loading toward route loaders and prefetching. rati's answer is the opposite move
with the same goal: make the waterfall *visible and movable* (where a prop is declared is
its scheduling) instead of hiding it in component hooks. That is a real position, not a
gap — but it means rati's story for "flatten the waterfall" is *move the load to an
earlier level*, and its story for "start before render" is today missing (§7, proposal
D1).

**Placeholder/initial data.** The field seeds a query with known-but-possibly-stale data
so the screen renders instantly. rati's resolved-props contract refuses to hand a
component data that isn't the real resolution — that's (b), and it's the same decision as
all-or-nothing. The honest mappings: data that is already known synchronously can simply
be returned by a load (a sync value resolves without suspending); long-lived data belongs
in a store bridged via `source()`, which is ready immediately on later mounts. What rati
deliberately doesn't offer is *render first, correct later* inside the resolved props.

## 2. Caching, dedup, and cross-screen data

| Field feature | rati today | Class |
| --- | --- | --- |
| [Query-key cache, `staleTime`/`gcTime`, dedup across components](https://tanstack.com/query/latest/docs/framework/react/guides/caching) (TQ v5); [SWR dedup](https://swr.vercel.app/docs/api) | none, on purpose: loads cache per island instance; "Not a request cache" ([guide](docs/current/public/guide.md)) — bring TQ/Apollo through `hook()` if you have one | (b) |
| [Loader SWR cache: `staleTime`, `gcTime`, `shouldReload`](https://tanstack.com/router/latest/docs/framework/react/guide/data-loading) (TSR 1.170) | no cross-navigation cache — the Router remounts per navigation, every visit re-resolves | (b), with the back/forward consequence below |
| Shared resolution across islands (two scopes with one head) | dedup happens in the source/store tier today | (c) — `.extend()` ([undecided/deferred-scope-features.md](undecided/deferred-scope-features.md)), `ResourceContainer` ([scope-and-island-directions.md §3](scope-and-island-directions.md)), layout-level scope ([router-extensions.md](router-extensions.md)) |
| [Structural sharing / tracked props](https://tanstack.com/query/latest/docs/framework/react/guides/render-optimizations) (TQ v5) | `collection`'s identity-stable reconcile (data territory); core keeps identity through the `equals` gate on refresh | (a) |

**The back/forward expectation.** Every neighbor makes back navigation instant: TanStack
Router serves the loader cache, Next 16.2 gates it behind
[`experimental.cachedNavigations`](https://nextjs.org/blog/next-16-2) and preserves state
with React [`<Activity>`](https://nextjs.org/docs/app/guides/preserving-ui-state), TQ/SWR
serve the stale entry and revalidate. In rati, `back()` re-resolves from scratch and shows
the loading slot. The recorded stance covers the *cache* half — instance-owned data in
stores makes a store-backed page's `source()` ready immediately on return, which is the
documented answer and works today. What it doesn't cover is plain-async-load pages, the
guide's own recommended simple path. This is adjacent to two recorded directions — the
"in-place stale window" (`<Activity>`-class rendering,
[scope-and-island-directions.md](scope-and-island-directions.md)) and the prefetch
handoff cache in proposal D1, which a retained-run variant could share machinery with —
so it is noted there rather than proposed separately. An adopter arriving from any
neighbor *will* ask.

## 3. Refresh, revalidation, and live data

| Field feature | rati today | Class |
| --- | --- | --- |
| [`invalidateQueries`](https://tanstack.com/query/latest/docs/framework/react/guides/query-invalidation) (TQ v5); [SWR global `mutate`](https://swr.vercel.app/docs/mutation) | `useScopeControls().refresh(key)` — surgical, equals-gated, cascade by read-sets; `mutation.refreshes` on the data side | (a) |
| [RR automatic revalidation after actions](https://reactrouter.com/start/framework/actions) + [`shouldRevalidate`](https://reactrouter.com/start/framework/route-module) (RR 8) | explicit `refreshes:` on `mutation` / explicit `refresh(key)` — rati chose explicitness; the `equals` gate is the `shouldRevalidate` analogue | (a) |
| [Polling `refetchInterval`](https://tanstack.com/query/latest/docs/framework/react/guides/window-focus-refetching) (TQ v5); [SWR `refreshInterval`](https://swr.vercel.app/docs/revalidation) | a `Source` — live data is a first-class load kind, not a refetch option | (a) |
| [Window-focus / reconnect revalidation](https://tanstack.com/query/latest/docs/framework/react/guides/window-focus-refetching) (TQ v5, on by default); [SWR `revalidateOnFocus`](https://swr.vercel.app/docs/revalidation) | nothing — core scopes don't revalidate on environment events; `rati/data`'s `reactive:` tracks store observables only | data-effort note (§below) |
| [SWR `useSWRSubscription`](https://swr.vercel.app/docs/subscription) (2.1+) | `Source` covers it, with lifecycle owned by the island | (a) |

## 4. Mutations, optimistic updates, forms

All excluded from proposing (data territory); the mapping for the record:

| Field feature | rati today (rati/data) | Class |
| --- | --- | --- |
| [`useMutation` lifecycle](https://tanstack.com/query/latest/docs/framework/react/guides/mutations) (TQ v5); [`useSWRMutation`](https://swr.vercel.app/docs/mutation) (SWR 2) | `mutation()` — callable with observable `isPending`/`error` | (a) |
| [Optimistic via cache write + rollback](https://tanstack.com/query/latest/docs/framework/react/guides/optimistic-updates) (TQ v5); [SWR `optimisticData`/`rollbackOnError`](https://swr.vercel.app/docs/mutation) | `optimistic:` patch + `onError: 'refresh'` recovery — refresh-as-rollback, no inverse patches | (a) |
| [Optimistic via in-flight variables / `useMutationState`](https://tanstack.com/query/latest/docs/framework/react/guides/optimistic-updates) (TQ v5) | instance-owned state makes the mutation itself observable anywhere | (a) |
| Action-model mutations ([RR actions + revalidation](https://reactrouter.com/start/framework/actions), RR 8; [Next Server Actions + `useActionState`/`useOptimistic`](https://nextjs.org/docs/app/getting-started/mutating-data), Next 16) | `form().submit()` is action-compatible (`<form action={store.save}>`); the rest of the React 19 action stack deliberately not adopted ([data-package.md §5](docs/archive/directions-2026-07/data-package.md)); server functions belong to a future RSC adoption ([postponed/rsc-support.md §6](postponed/rsc-support.md)) | (a)/(c) |
| No-JS progressive enhancement ([RR `<Form>`](https://reactrouter.com/start/framework/navigating), RR 8; [Next forms](https://nextjs.org/docs/app/api-reference/components/form), Next 16) | none. Position, recorded here: rati targets interactive apps; its SSR exists for first paint, not for JS-free operation. PE would arrive, if ever, with RSC/server functions — not as a bolt-on | (b) |
| [TQ paused-mutation offline queue](https://tanstack.com/query/latest/docs/framework/react/guides/mutations) (v5) | none | data-effort note |

## 5. Loading, pending, and stale UX

| Field feature | rati today | Class |
| --- | --- | --- |
| [`pendingComponent` + `pendingMs` (default 1000)](https://tanstack.com/router/latest/docs/framework/react/guide/data-loading) (TSR 1.170) | `loading` slot + `loadingDelayMs` (SI-02) | (a) |
| [`pendingMinMs` (default 500)](https://tanstack.com/router/latest/docs/framework/react/guide/data-loading) (TSR 1.170) — once shown, pending UI stays up a minimum | no minimum-display window: content swaps in the moment it's ready, so a slot that just appeared can flash away. The complement of `loadingDelayMs`; same gate, one more deadline. Noted, wait for a flicker complaint | (a), delta noted |
| [`keepPreviousData` → `placeholderData: (prev) => prev`](https://tanstack.com/query/latest/docs/framework/react/guides/placeholder-query-data) (TQ v5); [SWR `keepPreviousData`](https://swr.vercel.app/docs/api) | `keepStale` + `isStale` (SI-03), per island and per route | (a) |
| [`useNavigation` pending state](https://reactrouter.com/start/framework/pending-ui) (RR 8); [`useLinkStatus`](https://nextjs.org/docs/app/api-reference/functions/use-link-status) (Next 16); [NavLink `isPending`](https://reactrouter.com/start/framework/pending-ui) (RR 8) | none globally — per-island `phase` only | (c) — [router-extensions.md §Navigation status](router-extensions.md); field evidence is now three-for-three, and proposal D2 below needs the same mandala→router signal |
| [Retry/backoff on queries](https://tanstack.com/query/latest/docs/framework/react/guides/important-defaults) (TQ v5, 3× default); [SWR `onErrorRetry`](https://swr.vercel.app/docs/error-handling) | `retry: { count, backoffMs }` (SI-05), opt-in, `failed`-only | (a) |
| [Per-route error boundaries + `reset`](https://reactrouter.com/how-to/error-boundary) (RR 8); [`errorComponent`](https://tanstack.com/router/latest/docs/framework/react/guide/data-loading) (TSR 1.170) | `error` slot with `SourceError.code` switch + `retry` | (a) |
| [`notFound()` with fuzzy bubbling](https://tanstack.com/router/latest/docs/framework/react/guide/not-found-errors) (TSR 1.170); [RR `data(..., { status })`](https://reactrouter.com/how-to/error-boundary) (RR 8) | `NotAvailableError` → `not-available` in the slot, 404 on the server; routing 404 is the `*` route | (a) |

## 6. Routing: matching, params, search

| Field feature | rati today | Class |
| --- | --- | --- |
| Typed paths/params/links ([TSR type-safety](https://tanstack.com/router/latest/docs/framework/react/guide/type-safety), 1.170; [RR typegen](https://reactrouter.com/explanation/type-safety), RR 8; [Next `typedRoutes`](https://nextjs.org/docs/app/api-reference/config/typescript#statically-typed-links), 16, opt-in) | the literal tuple + `RatiUserTypes` — same `Register`-style pattern as TSR, no codegen step at all (RR and Next both need a generator) | (a) — rati is at full strength here |
| [Validated search params (`validateSearch`, Standard Schema), search middleware, `retainSearchParams`](https://tanstack.com/router/latest/docs/framework/react/guide/search-params) (TSR 1.170) | stringly `setSearchParams` | (c) — [router-extensions.md §Typed search params](router-extensions.md); TSR's Standard Schema support and middleware are new evidence for that record's converter-vocabulary design |
| Param validation/coercion at match time | permissive `[^/]+`, branded types arrive unvalidated | (c) — [router-extensions.md §Typed path converters](router-extensions.md) |
| [Optional params `{-$x}`](https://tanstack.com/router/latest/docs/framework/react/routing/routing-concepts) (TSR 1.170); [RR `:x?` + splats](https://reactrouter.com/start/framework/routing) (RR 8) | no optional segments; `*` catch-all only, un-captured | (c)-adjacent — regex routes are recorded ([router-extensions.md §`re_path()`](router-extensions.md)); optional segments would ride the same matcher work. Noted on that record, not separately proposed |
| [Guards: `beforeLoad` + throwable `redirect()`](https://tanstack.com/router/latest/docs/framework/react/guide/authenticated-routes) (TSR 1.170); [RR middleware, stable in v8](https://reactrouter.com/how-to/middleware) | route-level declarative `redirect` only; loads can 404 but not redirect | (c) — [router-extensions.md §Route/group guards](router-extensions.md). New evidence: both neighbors let *data code* redirect (throw-a-redirect), which that record's guard design should decide on |
| [Route masking](https://tanstack.com/router/latest/docs/framework/react/guide/route-masking) (TSR 1.170) | `navigate({ keepCurrentRoute, state })` covers the modal-over-page pattern from the other side (URL changes, view stays) | (a) |
| [Parallel + intercepting routes](https://nextjs.org/docs/app/api-reference/file-conventions/parallel-routes) (Next 16) | out of the model: the flat literal tuple renders one route; multi-pane UIs are the app's components + `keepCurrentRoute`/`state` | (b) |
| File-based routing ([TSR, recommended](https://tanstack.com/router/latest/docs/framework/react/routing/file-based-routing), 1.170; [RR fs-routes](https://reactrouter.com/start/framework/routing), 8; Next, only mode) | code-based only. Position, recorded here: the route table is a plain `as const` value — no generator, no virtual modules, types straight from literals. That is a *feature* of the model (the whole type machinery reads the tuple), and jnana-scale apps fit in one readable file. Fragment composition, if tables grow, is the recorded `include()` direction ([router-extensions.md](router-extensions.md)) — still values, still no codegen | (b) |
| [Nested layouts / `<Outlet>`](https://reactrouter.com/start/framework/routing) (RR 8); [pathless layouts](https://tanstack.com/router/latest/docs/framework/react/routing/routing-concepts) (TSR 1.170) | one `wrapper` per route, `group()` for shared slots — no stacking yet | (c) — [router-extensions.md §Nested wrapper stacks](router-extensions.md) (sketched), §Layout-level scope for the shared-data half |
| [Navigation blocking `useBlocker`](https://tanstack.com/router/latest/docs/framework/react/guide/navigation-blocking) (TSR 1.170, with async blocking); [RR `useBlocker`](https://reactrouter.com/api/hooks/useBlocker) (8) | none | (c) — [router-extensions.md §Navigation status & blocking](router-extensions.md) |
| [View transitions](https://reactrouter.com/api/components/Link) (RR 8, stable prop + `useViewTransitionState`); [TSR `defaultViewTransition` + types](https://tanstack.com/router/v1/docs/framework/react/api/router/ViewTransitionOptionsType) (1.170); [Next `<Link transitionTypes>`](https://nextjs.org/blog/next-16-2) (16.2, experimental) | none | (c) — [router-extensions.md](router-extensions.md) ("one-liner-sized, wait for need"); the field has since made it table stakes at the `Link` level — evidence noted, still wait-for-need |

## 7. Navigation: prefetching

The one axis where every neighbor is ahead of rati in the same direction, and the source
of proposal D1.

| Field feature | rati today | Class |
| --- | --- | --- |
| [TSR preloading: `'intent'` (hover+touch), `'viewport'`, `'render'`; `preloadStaleTime` 30s; `preloadRoute()`/`loadRouteChunk()`](https://tanstack.com/router/latest/docs/framework/react/guide/preloading) (1.170) — preloads *loader data*, not just code | `<Link prefetch>` preloads the **chunk only** (`preloadRoute` → `lazy().preload()`); the destination scope's data starts resolving only after navigation commits | **(d) → D1** |
| [RR `<Link prefetch>`: `intent`/`render`/`viewport`](https://reactrouter.com/api/components/Link) (RR 8) — fetches data + modules | same | **(d) → D1** |
| [Next `<Link>` auto-prefetch on viewport/hover, partial for dynamic routes](https://nextjs.org/docs/app/api-reference/components/link) (16); [prefetch cache overhaul](https://nextjs.org/blog/next-16) (16) | same | **(d) → D1** |
| [TQ `prefetchQuery` in event handlers / router loaders](https://tanstack.com/query/latest/docs/framework/react/guides/prefetching) (v5); [SWR `preload`](https://swr.vercel.app/docs/prefetching) (2) | nothing outside a mounted island can start a scope | **(d) → D1** |

## 8. Errors, scroll, and the rest of navigation UX

| Field feature | rati today | Class |
| --- | --- | --- |
| [TSR scroll restoration: keyed cache, nested `scrollToTopSelectors`, virtualized-list hook, per-navigation `resetScroll`](https://tanstack.com/router/latest/docs/framework/react/guide/scroll-restoration) (1.170); [RR `<ScrollRestoration>`](https://reactrouter.com/api/hooks/useBlocker) (8); [Next reworked scroll handler](https://nextjs.org/blog/next-16-2) (16.2) | POP/PUSH restoration exists, but restores on a double-rAF — before an async route's island has rendered, so the position clamps against the loading slot ([scrollRestoration.ts](packages/rati/src/router/scrollRestoration.ts) documents this as its own caveat) | **(d) → D2** for the async-route half; nested-container keys stay wait-for-need |
| Redirects: [route-level + throwable from loaders](https://tanstack.com/router/latest/docs/framework/react/guide/authenticated-routes) (TSR 1.170) | declarative route-level `redirect` with loop detection, real 30x on the server | (a) for route-level; the load-level half rides the guards record (§6) |
| [History state, back/forward semantics](https://reactrouter.com/api/components/Link) | per-entry `state`, `keepCurrentRoute`, memory history with a real entry stack | (a) |

## 9. Code splitting

| Field feature | rati today | Class |
| --- | --- | --- |
| [`route.lazy` / `.lazy.tsx` split files](https://tanstack.com/router/latest/docs/framework/react/guide/code-splitting) (TSR 1.170); [RR framework-mode auto-splitting + `splitRouteModules`](https://reactrouter.com/changelog) (RR 8) | `lazy()` + `<Link prefetch>` + SSR `modulepreload` of the matched chunk — the essentials, hand-declared | (a) |
| [TSR `autoCodeSplitting`](https://tanstack.com/router/latest/docs/framework/react/guide/code-splitting) (1.170) — bundler plugin splits automatically | none; splitting is per-route opt-in. Position: acceptable at rati's scale — automatic splitting is a file-based-routing dividend (the router owns the module graph), which rati declined (§6) | (b), follows from the file-based position |

## 10. SSR, streaming, SSG, RSC

| Field feature | rati today | Class |
| --- | --- | --- |
| Full-document SSR + hydration ([Start](https://tanstack.com/start/latest/docs/framework/react/overview), RC; [RR framework mode](https://reactrouter.com/start/framework/rendering), 8; Next) | the server kit: `renderApp` / `rati/vite` / `rati/server`, dehydration incl. source seeds, derived statuses, CSR fallback | (a) |
| Streaming SSR ([RR promise loaders](https://reactrouter.com/how-to/suspense), 8; [TSR deferred serialization](https://tanstack.com/router/latest/docs/framework/react/guide/deferred-data-loading), 1.170; [Next PPR-by-default under Cache Components](https://nextjs.org/docs/app/getting-started/caching), 16) | deliberate non-goal; `ssr: false` is the pressure valve | (c) — [undecided/ssr-streaming.md](undecided/ssr-streaming.md) (incl. the scope-levels-as-shell-line idea) |
| [Start selective SSR: `true` / `false` / `'data-only'`, inheritable, functions of params](https://tanstack.com/start/latest/docs/framework/react/guide/selective-ssr) (RC) | `ssr: false` per island (SI-04). `'data-only'` — resolve server-side, render client-side — is a matrix cell rati lacks; noted as evidence on the scope-and-island directions, wait for a consumer | (a), delta noted |
| SSG / ISR ([RR `prerender`](https://reactrouter.com/how-to/pre-rendering), 8; [Next `generateStaticParams` + ISR](https://nextjs.org/docs/app/guides/incremental-static-regeneration), 16) | a build loop over `renderApp` away | (c) — [ssg-and-rsc.md](ssg-and-rsc.md) |
| RSC / server functions ([RR experimental](https://reactrouter.com/how-to/react-server-components), 8; [Next](https://nextjs.org/docs/app/getting-started/fetching-data), 16; [Start `createServerFn`](https://tanstack.com/start/latest/docs/framework/react/guide/server-functions), RC) | none | (c) — [postponed/rsc-support.md](postponed/rsc-support.md); RR 8 shipping `unstable_reactRouterRSC` over `@vitejs/plugin-rsc` confirms that record's wrap-the-plugin read |
| Caching: [`use cache` / `cacheLife` / `revalidateTag`](https://nextjs.org/docs/app/api-reference/directives/use-cache) (Next 16) | out of rati's lane — rati has no server data cache; HTTP caching is the app's/CDN's | (b) |
| Head/meta ([RR route `meta`/`links`](https://reactrouter.com/start/framework/route-module), 8; [Next Metadata API + streaming metadata](https://nextjs.org/docs/app/api-reference/functions/generate-metadata), 16) | `<Title>`/`<Meta>` with dedupe-by-depth, server read-back, client sync | (a) |
| [Hydration mismatch diff overlay](https://nextjs.org/blog/next-16-2) (Next 16.2) | mismatch-throws-by-default in `rati/testing`, claim watchdog in dev | (a) |

## 11. Type safety

Where rati is strongest against the whole field: end-to-end inference with no codegen —
RR needs [`react-router typegen`](https://reactrouter.com/explanation/type-safety) (8),
Next needs [`next typegen`](https://nextjs.org/docs/app/api-reference/config/typescript)
(16, and typed routes are still opt-in), TSR matches rati's no-codegen inference (its
[`Register`](https://tanstack.com/router/latest/docs/framework/react/guide/type-safety)
is `RatiUserTypes`'s sibling) but leans on file-based generation for the route tree
itself. rati's `ScopeProps` inference (backend type → component prop with nothing written
twice) has no direct equivalent in any router-side neighbor; the closest is TQ's
[`queryOptions`](https://tanstack.com/query/latest/docs/framework/react/typescript)
helper (v5). No gaps found on this axis; the two typed holes rati does have — search
params and path params validation — are recorded ((c), §6).

## 12. DX: devtools, observability, testing

| Field feature | rati today | Class |
| --- | --- | --- |
| [TanStack Router Devtools](https://tanstack.com/router/latest/docs/framework/react/devtools) (1.170: routes, matches, loaders, params, context; overlay/embedded); [TQ Devtools](https://tanstack.com/query/latest/docs/framework/react/devtools) (v5: queries + mutations, browser extensions) | `navTrace` / `dataTrace` console tracers + named `Step`s in React DevTools (DX-07) — deliberately bounded at "no devtools UI" | **(d) → D3** — the panel beyond that boundary |
| [RR `instrumentations` API](https://reactrouter.com/changelog) (8.2); [Next DevTools MCP](https://nextjs.org/docs/app/guides/mcp) (16) | console tracers only; no structured export | folded into D3's cost/shape discussion |
| First-party test kits | `rati/testing` — island/router/stores harnesses + SSR round-trip kit. None of the four neighbors ships an equivalent; rati is ahead here | (a) |
| [Next `unstable_instant` build-time validation](https://nextjs.org/docs/app/guides/instant-navigation) (16.2) | nothing comparable; `dataTrace` makes waterfall cost visible at runtime. Interesting pattern (static analyzability of the model — rati's scopes are *more* statically analyzable than Next's trees), no proposal: it polices a caching model rati doesn't have | — |

---

## Proposals (class d)

Three, in rank order. Each follows the effort's format: problem, sketch in rati's
vocabulary, field precedent, cost, trigger. The research tree's wait-for-need discipline
applies — these are recommendations; graduation is the maintainer's call.

### D1 — Prefetch the data, not just the chunk

**Problem.** `<Link prefetch>` starts the lazy *chunk* on hover/touch and nothing else;
the destination scope's loads start only after navigation commits, inside the mounted
island. Every neighbor starts *data* ahead of intent: TanStack Router
[preloads the matched route's loaders](https://tanstack.com/router/latest/docs/framework/react/guide/preloading)
(`'intent'`/`'viewport'`/`'render'`, 50ms hover delay, 30s `preloadStaleTime`; 1.170),
React Router's [`<Link prefetch>`](https://reactrouter.com/api/components/Link) fetches
data and modules (8), Next
[auto-prefetches on viewport entry](https://nextjs.org/docs/app/api-reference/components/link)
(16). An adopter from any of them will read rati's `prefetch` prop as the same feature
and find it's a third of it. The hover-to-content gap is pure waterfall: chunk, then
mount, then level 1, then level 2.

**Sketch.** This is cheap *because* of the model — the two hard questions the field
answers dynamically have static answers in rati:

- *What can be prefetched?* The scope declares it. Walk the levels: a level whose loads
  are plain function/promise/class entries over the inputs (route params, available from
  the href at hover time) is startable outside React; the first level containing a
  `hook()` load ends the prefetchable prefix (hooks need a tree). That prefix is
  computable from the scope value alone — no component runs, no render. A scope headed by
  `hook(() => useStores())` has an empty prefix and prefetch degrades to today's
  chunk-only behavior, honestly.
- *Where does the result go?* The consumption path already exists: hydration's `data`
  slice short-circuits `buildCell` to a value cell. A prefetch handoff is the same shape
  with a different carrier — a small per-route, latest-wins store the router owns
  (`preloadRoute` is already the seam; it matches the path and reaches the route's
  `scope`). The mandala consults it on first mount exactly as it consults the hydration
  slice: claimed once, then dropped.

Policy kept minimal on purpose: one slot per route name (latest wins), a short TTL
(the field's 30s is a reasonable default), abort the in-flight prefix via the existing
per-bucket `AbortController` if a different route is prefetched, and the `equals`
question never arises — a claimed value is exactly what the load would have produced
moments later. `prefetch` stays one boolean; an `'intent' | 'viewport'` refinement can
follow the field later if wanted.

**Precedent.** All four neighbors, cited above; TQ's `prefetchQuery`/SWR's `preload` are
the same idea one layer down.

**Cost.** The prefix walker (small — the level shapes are already classified by the
resolver), the handoff store + claim path (bounded; mirrors hydration), staleness/abort
policy, and tests for the race matrix (prefetch vs navigate vs second hover). The real
risk is scope creep toward a request cache — the one-slot latest-wins design is the
guard: this is a *handoff*, not a cache, and the recorded no-request-cache stance stands.

**Trigger.** The first consumer with visible navigation latency on promise-load routes —
jnana's page switches are the obvious candidate. Also the natural second act for the
back/forward expectation (§2): a retained-run variant could reuse the same handoff shape.

### D2 — Scroll restoration that waits for the content

**Problem.** Restoration fires on a double-rAF after navigation
([scrollRestoration.ts](packages/rati/src/router/scrollRestoration.ts)); an async
route is still showing its loading slot then, so the restored position clamps against the
slot's height and the user lands at the top (or mid-nowhere) instead of where they were.
The file's own header calls tying restoration to data boundaries "a future enhancement" —
this proposal is that line, formalized. The field has moved past rati here: TanStack
Router keys and restores [per element, supports nested containers and virtualized lists](https://tanstack.com/router/latest/docs/framework/react/guide/scroll-restoration)
(1.170), and its loader model means content is there when restoration runs; Next 16.2
[reworked scroll/focus handling](https://nextjs.org/blog/next-16-2) similarly.

**Sketch.** On POP to a scope-carrying route, defer the restore until the destination
island reports content — the signal already exists (`phase` flips to `'ready'` at the
leaf's commit; the reportPhase store is exactly "which slot is on screen"), it just isn't
plumbed to the router. A timeout cap (say one second) falls back to today's behavior so a
slow load never strands the scroll. PUSH keeps scrolling to top immediately; a
`keepStale` re-resolve needs nothing (content never left). The plumbing — a
mandala→router "destination committed" signal — is the *same* signal the recorded
pending-navigation direction needs
([router-extensions.md §Navigation status](router-extensions.md) names it explicitly),
so building either pays for both; this proposal extends that record rather than
competing with it. Nested-container keys and virtualized-list APIs stay out —
wait-for-need, and rati's `scrollToTop` override already covers the fixed-header case.

**Precedent.** TanStack Router and Next as cited; React Router's `<ScrollRestoration>`
(8) restores after loader completion by construction (loaders block render).

**Cost.** Small: the signal, a deferred-restore branch in `applyScroll`, the timeout, and
tests (jsdom has no layout, so the pins assert sequencing, not pixels — the existing
harness pattern). No behavior change for sync routes or PUSH.

**Trigger.** The first consumer with long scrollable lists behind async routes — jnana's
page lists again. Cheap enough that the trigger bar can be low.

### D3 — A devtools panel over the tracers

**Problem.** The field treats a visual inspector as part of the framework: TanStack ships
[Router Devtools](https://tanstack.com/router/latest/docs/framework/react/devtools)
(routes, matches, loader state, embedded or overlay; 1.170) and
[Query Devtools](https://tanstack.com/query/latest/docs/framework/react/devtools)
(v5, plus browser extensions); Next 16 ships a DevTools panel and
[an MCP server](https://nextjs.org/docs/app/guides/mcp). rati's observability is two
console tracers (`navTrace`, `dataTrace`) and named components in React DevTools — DX-07
delivered exactly that and drew its boundary at "no devtools UI, no structured trace
export" ([DX-07](docs/planned/testing-and-dx/issues/DX-07-observability.md)). For the
maintainer that is enough; for a first external adopter, a panel is often the first
"is this framework real" signal — and rati's model makes an unusually good one possible.

**Sketch.** The scope is a plain value: the panel can render the *declared* waterfall
(levels, keys, kinds — function/source/hook) statically, then light it up with the run's
events — `dataTrace` already emits level starts, cell settles, refresh causes; the
missing piece is a structured sink beside the console formatter (the tracer's events
become a typed stream a panel subscribes to; the console stays the default sink). Add
the router's table and active match, and `useScopeControls`'s phase per island. An
overlay component (`<RatiDevtools />`, dev-only, tree-shaken in production like the
field's) rather than a browser extension — the extension is the expensive half and can
wait.

**Precedent.** As cited; RR 8.2's
[`instrumentations` API](https://reactrouter.com/changelog) is the structured-events
half of the same idea.

**Cost.** The largest of the three by far: real UI, ongoing maintenance, and design care
so the structured sink doesn't slow the traced-off path (DX-07's zero-cost-when-off rule
must hold). The structured sink alone is small and independently useful (tests could
assert on it too) — a sensible first slice if this graduates.

**Trigger.** External adoption ambitions (the website effort going live is the natural
moment). Not jnana-driven — the maintainer reads the console.

---

## Notes filed to the data effort

Gaps that land in `src/data/` territory (excluded from proposing here; the data-package
effort inherits the note):

- **Environment revalidation triggers.** TQ revalidates on window focus and reconnect
  [by default](https://tanstack.com/query/latest/docs/framework/react/guides/important-defaults)
  (v5); SWR the same ([`revalidateOnFocus`/`revalidateOnReconnect`](https://swr.vercel.app/docs/revalidation), 2).
  `query`'s `reactive:` tracks store observables only — there is no "refresh this query
  when the tab refocuses" story. Fits the existing options bag if ever wanted
  (`revalidateOn: ['focus', 'reconnect']`-shaped).
- **Offline posture.** TQ has [network mode, paused mutations, and a first-party persister](https://tanstack.com/query/latest/docs/framework/react/guides/network-mode)
  (v5); rati/data has nothing and probably shouldn't (jnana is online-first) — but the
  position deserves a line in the data effort's record so it's a decision, not a hole.
- **`pagedCollection` memory cap.** TQ's infinite queries grew
  [`maxPages`](https://tanstack.com/query/latest/docs/framework/react/guides/infinite-queries)
  (v5) to bound retained pages; the pages-as-queries array has no cap today.
- **Mutation serialization.** TQ's [mutation `scope.id`](https://tanstack.com/query/latest/docs/framework/react/guides/mutations)
  (v5) serializes related mutations — field evidence for the data record's open
  "mutation coalescing/serialization" question ([data-package.md §Open questions](docs/archive/directions-2026-07/data-package.md)).

## Top-3

If only three things are read out of this session:

1. **D1 (prefetch the data)** — the one axis where all four neighbors are ahead in the
   same direction, the gap an adopter hits in their first hour (`prefetch` looks like
   the field's prop and does a third of it), and the proposal where rati's declarative
   scope turns the field's hard dynamic problem into a static walk.
2. **D2 (scroll restoration waits for content)** — small, self-contained, shares its one
   piece of plumbing with the already-recorded navigation-status direction, and fixes a
   silent UX wrongness (restored scroll clamping against a loading slot) that no test
   currently sees.
3. **The §2 back/forward note** — not a proposal, but the expectation gap most likely to
   generate an adopter's first "is this broken?" question: every neighbor makes back
   instant, rati re-resolves. The recorded answers (store-held data; the in-place stale
   window direction; D1's handoff shape) should be weighed together when any of them
   graduates.
