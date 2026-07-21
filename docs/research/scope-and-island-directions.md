# Scope & island directions — resolution, loading states, sharing

> **Parts 1 and 2 shipped** — cut 2026-07-19 and executed as the
> [scope-and-island effort](docs/planned/scope-and-island/README.md) (all six directions,
> including the two below marked wait-for-need — the decisions and findings are recorded
> there, and where a record and this doc disagree, the record wins). Part 3
> (`ResourceContainer`) stays open research, and execution left three new open directions,
> marked **(open, post-execution)** below.

Forward-looking options for scope resolution and the island's loading/error presentation.
**None of these are implemented** — each waits for a real (Jnana- or consumer-driven) need so
the shape is pinned by a concrete use case. Distilled from the July 2026 design review
(`improvements.md` §1/§2/§5; the review's shipped items — selective refresh via
`useScopeControls`, the `data()` marker, SSR-capable sources, the SSR-error baseline — landed
and are recorded in [docs/archive/directions-2026-07/](docs/archive/directions-2026-07/)).

Already-sketched neighbours that live in their own records: the undecided scope primitives
`.live()` / `.extend()` and the bare-hook dev guard
([undecided/deferred-scope-features.md](undecided/deferred-scope-features.md)), the cross-layer
`derive()` escape hatch ([undecided/dependency-graphs.md](undecided/dependency-graphs.md)), and
the router-side resolution work ([router-extensions.md](router-extensions.md)).

## 1. Scope & resolution

### Abort signals for data loads

A param change or teardown discards a level's in-flight promise loads, but the underlying
`fetch` keeps running. Passing an `AbortSignal` as a second argument lets a load opt in to
real cancellation; rati aborts it when the tree remounts (param change / retry) or unmounts:

```ts
scope({ spaceId: input<Uuid>() })
    .load({
        members: ({ spaceId }, { signal }) =>
            apiClient.spaces[':spaceId'].members.$get({ param: { spaceId } }, { signal }),
    });
```

Cheap to add (the resolver already owns the remount boundary — one `AbortController` per
bucket), backwards compatible (loads that ignore the second argument behave as today).
Sources don't need it: `detach()` is already their cancellation. (The `rati/data` `query`
already threads an `AbortSignal` through its producer; this is the core-scope analogue, still
missing.)

**Shipped as SI-01** (`LoadContext`, one controller per bucket). Two seams it deliberately
left open, both wait-for-need (SI-01's findings in the
[effort README](docs/planned/scope-and-island/README.md#findings)):

- **Per-key cancellation (open, post-execution).** The signal belongs to the bucket, so a
  `refresh(key)` that supersedes its *own* in-flight re-fetch (the double-click) leaves the
  predecessor running — latest-wins by token, but the wasted request is never aborted.
  Fixing it means a controller per cell and the teardown discipline that implies; worth its
  own item if a consumer hits it.
- **The SSR request-abort seam (open, post-execution).** React's half exists — `prerender`
  takes a `signal`, and `rati/testing`'s settle watchdog drives it — but nothing connects an
  aborted *request* to the per-bucket controllers, so a client disconnect leaves the loads
  running. The shape: `renderApp` (which today takes no request signal at all) accepts one,
  threads it as a run-level parent signal on `Shared`, and each bucket composes its
  controller with it. A server-side item; lands with the first consumer that terminates
  requests.

## 2. Islands / mandala — advanced loading states

The `remoteData` features worth keeping that are **presentation** concerns — pending
indication delay and stale-data display — belong in the mandala, not the data layer (the
data layer reports honest phases; the island decides what the user sees — see the archived
[data-package.md](docs/archive/directions-2026-07/data-package.md) for the split).

### Delayed loading slot (`loadingDelayMs`)

Fast resolutions shouldn't flash a spinner. An island-level option delays the loading slot;
until the delay elapses the island renders nothing (first load) or the previous content
(re-resolve, below):

```ts
island({
    scope: usersScope,
    component: UsersTable,
    loading: Spinner,
    loadingDelayMs: 200,      // slot appears only if resolution takes longer
});
```

Per-island rather than per-load: the aggregate phase is what the user sees. A route island
would take the same option in `RouteOptions`. (This is the rehome of the legacy
`remoteData`'s `indicatePendingAfterTimeoutMs` — the name should point at the slot it
modulates, hence `loadingDelayMs`.)

### Stale content on re-resolve (`keepStale`)

On a param change or `refresh()` the island today tears down and re-renders the loading
slot. Often the better UX is keeping the previous content visible, marked stale, until the
new resolution is ready — the islands analogue of stale-while-revalidate. Two options:

- **Option A — island option + status hook (recommended).** `keepStale: true` keeps the
  last-ready props rendered during re-resolution; the subtree reads the phase to dim/badge:

  ```ts
  island({ scope, component: UsersTable, loading: Spinner, keepStale: true });

  function UsersTable(props: ScopeProps<typeof usersScope>) {
      const { isStale } = useIslandStatus();   // { phase, isStale, refresh? }
      return <Table data={props.users} className={isStale ? 'opacity-60' : ''} />;
  }
  ```

  Fits the existing engine: the mandala already holds the committed bucket; keeping the
  previous resolved props during a `treeKey` remount is a controlled extension of that.

- **Option B — React transitions.** Wrap the param-change re-render in
  `startTransition` and let Suspense keep showing old content, reading staleness from
  `useDeferredValue` comparisons. Less code owned by rati, but the behavior becomes
  React-scheduling-dependent and harder to make deterministic per island (and source-backed
  pending doesn't suspend, so it wouldn't be covered uniformly).

Note the interplay: `loadingDelayMs` handles "don't flash on fast loads"; `keepStale`
handles "don't blank on re-loads". They compose — with both set the loading slot appears
only for a slow **first** load. `useScopeControls` (shipped) does not yet expose
`phase`/`isStale`; that half arrives with this batch, and the error-slot `retry` could fold
in too.

**Shipped as SI-03 (Option A) + SI-02**, with one structural limitation found after the
fact (verified 2026-07-20, documented in the guide/reference and internals):

- **In-place stale window (open, post-execution).** The shipped mechanism renders the kept
  run in whatever not-ready position is current — usually the Suspense fallback — which is
  a different fiber position from the live leaf. So the continuity is visual, not
  instance-level: entering the window mounts a second instance of the component, a site
  move mid-window is another unmount/mount pair, and the swap mounts the successor fresh.
  Component-local state (form drafts, focus, inner scroll) does not survive; the kept
  *resources* (sources, the `.provide()` value) do, which is why store-held state is the
  documented answer. True instance continuity would need the component hoisted to a stable
  fiber position outside the keyed inner tree — a resolver restructuring with SSR
  consequences (`prerender` needs the component's HTML inside the boundary) — or
  React `<Activity>`-class hidden rendering for the resolving tree. Either is a real
  redesign of the window, not a patch on it; wait for a consumer who actually loses state
  they needed (the motivating jnana case wants visual continuity only).

### Retry policy (brief)

`error` slots get manual `retry` today. An optional per-island automatic policy —
`retry: { count: 2, backoffMs: 500 }` for `error.code === 'failed'` only (never
`not-available`) — would remove boilerplate retry buttons for transient network failures.
Wait for a real need; noted because the retry counter already exists.

### Per-island SSR opt-out (`ssr: false`)

Under `prerender` every promise load gates TTFB — there is no "this island is below the
fold / expensive / personalized, ship its loading slot instead". An island/route-level
`ssr: false` would skip starting its loads on a collected render, emit the loading slot,
and resolve client-side — the mirror of the source `ssr: true` marker (shipped),
completing the matrix. Mechanically small (the mandala checks the option when `collect` is
present and renders the loading slot without building promise cells). This is also the
sanctioned pressure valve for the deliberate non-goal of streaming SSR: `prerender` stays
all-or-nothing; islands that shouldn't block opt out.

### SSR error surfacing — options beyond the shipped baseline

What already shipped (2026-07): rejected loads are recorded by the collector (`errors` →
status mapping, `not-available` → 404), the HTML degrades to the loading slot with React's
client-retry marker, and the client re-runs the load on hydration (self-healing, no
mismatch — pinned by `islandSsrErrors.test.tsx`). Options beyond that, if a real consumer
wants them:

- **Dehydrate the error.** Carry the normalized `SourceError` in a third wire section so
  the client renders the *error slot* immediately (with `retry`) instead of re-running
  the load. Requires catching at the resolver level (the boundary never runs
  server-side) and a hydrate-to-error path in `buildCell`. Trade-off: deterministic
  first paint vs. losing the self-healing retry — probably a per-island choice, e.g.
  `ssrErrors: 'retry' (default) | 'dehydrate'`.
- **Disable the automatic client retry.** Today React's boundary-abandonment mechanism
  *is* the retry; suppressing it means the same dehydrate-the-error machinery (the
  client must render something other than a re-running load). The two options are one
  feature with two defaults.
- **Richer status policy hooks.** `renderApp` exposes `errors`/`matchedCatchAll` raw, so
  apps already can derive status; a `deriveStatus` callback option would formalize it if the
  inline derivation stops being enough.

## 3. Shared resource lifetimes — `ResourceContainer` may migrate into rati

From `jnana/frontend/src/common/resources/`. It is framework-shaped already — generic,
domain-free ref-counting with `Disposable` integration, and rati's island teardown already
feature-detects `[Symbol.dispose]` on provided values. If it moves, it lands in core (it has
no MobX dependency) next to `Source`; `ResourcePool`'s `source()` adapter shows the two
compose. That would also give `.extend()` / layout-scope work
([router-extensions.md](router-extensions.md), the layout-level scope idea) a sanctioned
sharing layer — dedup by ref-count under shared heads instead of scope-level caching.
