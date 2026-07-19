# scope-and-island — resolution control and advanced loading states

Status: planned 2026-07-19. Per-item status derives from rati git (`git log --grep 'SI-'`,
`Closes:` trailers) — never from this file; conventions below.

Executes parts 1 and 2 of
[scope-and-island-directions.md](../../research/scope-and-island-directions.md) — the scope/
resolution half (abort signals) and the island loading-state half (`loadingDelayMs`,
`keepStale` + the status surface, retry policy, per-island `ssr: false`, SSR-error
dehydration). Part 3 (`ResourceContainer` migrating into core) stays in research — it waits
on the `.extend()` / layout-scope work and is not cut here.

The research doc holds the design detail (sketches, trade-offs, the interplay notes); each
item record points at its section rather than restating it. Where a record and the research
doc disagree, the record wins — it is the executed decision.

## Decisions taken 2026-07-19 (at cut)

- **All six directions are cut**, including the two the research doc marked wait-for-need
  (retry policy, SSR-error options) — maintainer's call at the cut: the effort prepares the
  island surface as a whole rather than leaving two known gaps for consumers to hit.
- **The status surface extends `useScopeControls`** — no new hook. `phase` / `isStale` (and
  the error-slot `retry`, folded in) land on the controls object `mandala/controls.ts`
  already returns. The research doc's `useIslandStatus` sketch is dropped; plain-naming rule:
  no second public name for the same channel.
- **`keepStale` is Option A** (engine-owned kept props + status flag), not Option B (React
  transitions) — determinism per island, and source-backed pending wouldn't suspend anyway.
- **`SI-03` precedes `SI-02`.** The research doc presents `loadingDelayMs` first, but its
  re-resolve behavior ("previous content until the delay elapses") needs the same
  kept-committed-bucket mechanism `keepStale` is built on. The engine change lands once, in
  SI-03; SI-02 rides it.
- **Cut assuming the stores-container work has landed** (table-blind router surface,
  `StoresProvider` / `createStoresHook`). If an item finds the shipped surface differs from
  [stores-container-implementation.md](../../research/stores-container-implementation.md),
  reconcile against what actually shipped and note it here.

## Items

SI-01 (abort signals) and SI-04 (`ssr: false`) are independent of everything and of each
other — they run first, in parallel. SI-03 is the effort's heart and its calibration gate:
it teaches the mandala to keep the last committed props across a re-resolve and extends
`useScopeControls` with the status surface; its semantics review gates the rest. SI-02
(`loadingDelayMs`) builds on the kept-bucket mechanism and pins the composed contract
("the loading slot appears only for a slow first load"). SI-05 (retry policy) and SI-06
(SSR-error dehydration) close the effort as a serial lane — both touch `boundary.tsx`, and
SI-05 reads SI-03's phase surface (an automatic retry must be visible as a phase, not a
frozen error slot).

- [SI-01 — abort signals for data loads](./issues/SI-01-abort-signals.md)
- [SI-02 — `loadingDelayMs`](./issues/SI-02-loading-delay.md)
- [SI-03 — `keepStale` + the status surface on `useScopeControls`](./issues/SI-03-keep-stale-status.md)
- [SI-04 — per-island `ssr: false`](./issues/SI-04-ssr-opt-out.md)
- [SI-05 — automatic retry policy](./issues/SI-05-retry-policy.md)
- [SI-06 — SSR error dehydration (`ssrErrors`)](./issues/SI-06-ssr-error-dehydration.md)

Batching, dependencies, grading: [plan.md](./plan.md).

## Findings

(Appended as dated notes as items execute; a real engine bug found mid-item is a finding to
surface, not to silently fix.)

### 2026-07-19 — SI-01 (abort signals) shipped + decisions

Two commits: the engine + type change, then the pins. `yarn ci` green; 65 files / 581 tests.

- **`LoadContext`, not `LoadOptions`.** `DataLoadOptions` (the `data(fn, { equals })`
  config) already owns "options" one screen away in the same file; two neighbouring types
  called options would be a naming trap for exactly the readers this argument is new to.
  The bag is the load's *run* seen from inside — TanStack's `QueryFunctionContext` is the
  same call. Exported from the main barrel so a load extracted into its own function can
  name its second parameter.
- **The signal belongs to the bucket, so `refresh(key)` shares it** — a selective refresh
  replaces a load *inside* a live run, and cancelling there would kill data the island
  still intends to show. The consequence the record's discard list doesn't cover: a
  `refresh(key)` that supersedes its *own* in-flight re-fetch (the double-click) leaves the
  predecessor running, as today. Per-key cancellation needs a controller per cell, with the
  teardown discipline that implies — not cut here; worth its own item if a consumer hits it.
- **Class loads get no context.** The record's shape is `(props, { signal })` for function
  loads; a class load constructs a value, and what it starts it owns (its `[Symbol.dispose]`
  is the teardown seam). Adding a second constructor parameter would also widen
  `{ new (resolved): any }` in `LoadDefinition` for no case anyone has.
- **The swallow is load-bearing, and only for producer-backed promises.** A level suspends
  on the first pending `use()`, so a *sibling* promise built in the same pass never reaches
  `use()` and carries no handler at all — that is the one that surfaces as an unhandled
  rejection when the run is aborted (verified by removing the line: `AbortError` straight to
  Node's `unhandledRejection`). Static promise entries are deliberately left alone: they
  never received the signal, and marking a shared module-level promise as handled forever
  isn't the engine's call.
- **`refreshFailed` had to learn the difference between cancelled and failed** — otherwise
  unmounting with a `refresh(key)` in flight logs `[rati] refresh('x') failed — keeping the
  previous value.` at every teardown, for a load nobody is keeping anything for.
- **No abort reason argument**, so `signal.reason` stays the standard `AbortError`
  `DOMException` — the `error.name === 'AbortError'` check every fetch wrapper already has
  keeps working. A rati-flavored reason would read better in a debugger and break that.
- **The SSR request-abort seam (the record asked): real, but not this item's.** React's half
  is already there — `prerender` takes a `signal`, and `rati/testing`'s settle watchdog
  drives it (DX-08). The missing half is the loads': nothing connects a request to the
  per-bucket controllers, so it wants a run-level parent signal threaded on `Shared`
  (`renderApp` → `renderToHtml` → the resolver) and composed per bucket. That is a
  server-side item — `renderApp` doesn't take a request signal at all today — and it lands
  with one, not here.
- **The examples gained nothing on purpose.** The gallery's job is foregrounding
  server/client behavior; a signal that never fires server-side has nothing to show there,
  and the guide's `fetch` example is the whole story on the client.

### 2026-07-20 — SI-04 (`ssr: false`) shipped + decisions

Two commits: the engine + threading + pins, then the gallery page; docs alongside.
`yarn ci` green; 66 files / 589 tests.

- **The gate is `getServerSnapshot`, not the collector.** The record framed the condition
  as "`false` and a collector is present (server render)" — the collector being the
  mandala's only way to know where it is. `useSyncExternalStore`'s third argument is a
  better one: React reads it on the server *and* through the client's hydration pass, which
  is exactly the pair of renders that must show the slot. The consequence is a small
  widening — the option now means the same thing under a bare `prerender` with no
  `HydrationProvider` — which reads as the more honest behavior for an option named `ssr`.
- **What the hook really buys is the hydration pass, not the server render.** Rendering the
  slot server-side is the easy half; the trap is the client. Let the island resolve
  normally on its first client render and it suspends *inside* a boundary React is
  hydrating — React discards the server markup and client-renders it, which surfaces as a
  recoverable error (`ssrRender().hydrate()` throws on exactly this, and its message
  already named the cause: "a load that re-ran and re-suspended on its loading slot").
  Deferring to the post-hydration re-render is what makes the round trip silent — verified
  in a real browser too, not just jsdom: zero console output on `/deferred`.
- **`foldInputs` had to learn the option.** A `group` re-folds a child's mandala whenever it
  supplies a `loading`/`error` slot the child lacks — and a re-fold that didn't carry `ssr`
  would silently turn SSR back on for exactly the routes a group is most likely to wrap.
  Pinned in `router/group.test.tsx`.
- **No `ssr` default on `GroupDefaults`.** A group defaults *presentation* (wrapper, slots);
  "does this page gate TTFB" is a per-route judgment, and a group-wide opt-out would be a
  foot-gun that reads like a layout choice. Not cut, and not missed — say so if a consumer
  asks.
- **The fuzz suite never moved**, which is the tripwire working: the harness sets no `ssr`
  option, and `ssrEnabled` is a build-time constant, so the default path renders the exact
  element tree it did before.
- **A finding for SI-02, free:** the loading slot is threaded from a single place
  (`mandala.tsx`'s `Loading`) into all three sites that can show it — the Suspense fallback,
  a pending source in `Step`, and `ProvideLeaf`'s build frame. `loadingDelayMs` gates that
  one binding, so the delay does not need to be taught about the three sites separately.

## Per-item conventions

Atomic commits on the current branch (rati `CLAUDE.md`); subjects prefixed `SI-NN:`, a
`Closes: SI-NN` trailer on the finishing commit. `yarn ci` green before handing over
(`scripts/ci.ts` — fmt / lint / typecheck / test / deep fuzz / build). Public surface changes
document in `docs/current/public/` (guide + reference) in the same item;
`docs/current/internals.md` when the mandala's machinery changes. Findings out of an item's
scope get a dated note appended here.
