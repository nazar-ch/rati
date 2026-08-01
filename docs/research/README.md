# Research — open directions

Everything here is **not implemented**. It is design space: forward-looking directions, each
waiting for a real (Jnana- or consumer-driven) need so the shape is pinned by a concrete use
case. If a direction ships, its record moves to [docs/archive/](docs/archive/); if it's actively
being executed, it becomes a [docs/planned/](docs/planned/) effort. Anything that stays here is,
by construction, not yet in the code.

This is the flattened successor of the `directions-2026-07/` design review — the review's
**shipped** documents (naming renames, the data package, selective refresh + SSR sources, the
SSR server kit + nazar-pattern absorption) now live in
[docs/archive/directions-2026-07/](docs/archive/directions-2026-07/); its still-open options were
regrouped by topic into the files below.

## Topics

- [field-gap-analysis.md](field-gap-analysis.md) — the IMP-01 comparison against
  react-query/SWR, TanStack Router, React Router 8 and Next 16 (versions cited at
  2026-07-20): every daily-driver field feature classified through rati's stance, plus
  three net-new proposals — intent-based data prefetch, commit-aware scroll restoration,
  a devtools panel over the tracers.
- [scope-model-capabilities.md](scope-model-capabilities.md) — the IMP-02 walk of what
  "the spec is data" uniquely enables: a supported scope-shape read, running the hook-free
  prefix outside React (the prefetch/D1 slice), a level-placement advisor on the data
  trace, declaration-level test doubles, and the written defense of all-or-nothing
  (nested islands as the sanctioned partial shape).
- [scope-and-island-directions.md](scope-and-island-directions.md) — abort signals for data
  loads; advanced island loading states (`loadingDelayMs`, `keepStale` + status hook, retry
  policy, per-island `ssr: false`, SSR-error dehydration options); `ResourceContainer` migrating
  into core for shared resource lifetimes. **Parts 1–2 shipped** (the
  [scope-and-island effort](docs/planned/scope-and-island/README.md), closed 2026-07-20); still
  open there: part 3 plus three post-execution directions (in-place stale window, per-key
  cancellation, the SSR request-abort seam).
- [router-extensions.md](router-extensions.md) — `group`/`include` composition, nested wrapper
  stacks, layout-level scope, namespaced names, typed path converters, route guards, regex paths;
  plus typed search params and navigation status/blocking.
- [stores-and-router.md](stores-and-router.md) — the stores-container pattern assessment: what
  it buys, the router-induced dependency cycles, and the options for resolving them.
- [stores-container-implementation.md](stores-container-implementation.md) — the concrete
  Option A plan (table-blind `AppRouter` surface + the stores-cluster renames from the naming
  review §6). The rename mechanics landed (`input`, `RouterStore`, `useRouter`, the `rati/ssr`
  + `rati/debug` entries); this shape change did not.
- [ssg-and-rsc.md](ssg-and-rsc.md) — SSG (a build script over the shipped `renderApp`) and RSC
  as a compatibility constraint; direction only.
- [dx-and-tooling.md](dx-and-tooling.md) — test utilities (`rati/testing`), a `dataTrace`
  sibling to `navTrace`, DevTools naming for `Step` components. **In execution:**
  [../planned/testing-and-dx/](docs/planned/testing-and-dx/README.md) (cut 2026-07-19).

## Parked (left as-is — not part of this sort)

- [undecided/](undecided/) — `deferred-scope-features.md` (`.live()` / `.extend()` / bare-hook
  guard), `dependency-graphs.md` (`derive()`), `ssr-streaming.md`. Weighed, not decided.
- [postponed/](postponed/) — `rsc-support.md`. Concretized, explicitly deferred.
