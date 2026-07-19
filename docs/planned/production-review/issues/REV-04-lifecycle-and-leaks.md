# REV-04 — lifecycle, teardown & leaks

area: every subscribe/attach/listener/timer/cache across packages/rati/src (excluding
      data/): mandala buckets + channels, Source attach/detach, router + history +
      scrollRestoration, stores, vite plugin (HMR), server handles
needs: — (best after scope-and-island lands — SI adds timers and kept buckets to audit)
disposition: cut 2026-07-19; production-review lens 4

## Problem

Long-lived apps and dev sessions (HMR) accumulate whatever rati forgets to release. The
router already paid this bill once (RF-01: `createBrowserHistory`'s popstate listener
outlived every consumer; found by review, not by symptom — leaks have no behavioral shadow
until they do). Nobody has walked the whole tree with that lens: every resource acquired,
who releases it, and what proves it.

## Scope

1. **Inventory, then verify.** Enumerate every acquisition site: event listeners (window,
   history, media), `subscribe` registrations (uSES stores, channels), source
   `attach`/`detach` pairs, timers/intervals (clock sources, SI-02 delays, SI-05 backoffs
   if landed), Maps/WeakMaps that cache per-scope/per-island state (channel registries,
   scope labels, hydration payload refs), `[Symbol.dispose]` feature-detected teardown of
   provided values, the collector's per-request state, server sockets/watchers. For each:
   the release site, or the reasoned claim it lives for the process — written down.
2. **Drive the hot cycles.** Mount/unmount an island in a loop with a live source (ledger
   must return to zero — the fuzz harness ledgers are the tool); create/dispose sequential
   `RouterStore`s (the RF-01 pin pattern — extended to any other window-touching module,
   scrollRestoration first); route in/out of a page repeatedly; per-request SSR loop
   (`renderApp` over many requests — collector and router instances must not accumulate;
   memory growth measured, not assumed).
3. **StrictMode double-mount** as a *teardown* stress: effects run twice — anything
   acquired twice must release twice (the strictModeLifecycle suite exists; extend where
   the inventory finds uncovered acquisition sites). Semantics questions go to REV-07.
4. **HMR (dev):** the vite plugin across repeated edits — do stores/routers/listeners
   stack? A dev-only leak is still a finding (dev sessions are hours long).
5. **Teardown ordering:** dispose during in-flight resolution, unmount during a source
   emit, dispose re-entrancy (double-dispose is REV-02's message concern; the *state*
   correctness is this lens's).

## Boundaries

- `src/data/` excluded (its `reactive` Reaction lifecycles review with the data effort).
- The altitude rule from the fuzz efforts binds pins: assert observable facts (ledger
  counts on the *test's own* fakes, behavior after dispose) — a pin counting internal
  listeners is a test bug, except at a surface's own public contract (the RF-01 History
  lesson).
- Rendering-mode semantics (concurrent, Suspense timing) are REV-07's.

## Verify

- The inventory table (acquisition → release → evidence) in the findings note — the
  claim-per-resource is the deliverable even where everything is clean.
- Each driven cycle's result recorded; fixes pinned with leak-shaped tests at the owning
  surface.
- `yarn ci` green after fixes, deep fuzz included (teardown fixes are exactly where the
  mandala/router fuzz suites bite).
