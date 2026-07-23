---
area: rati's React contract: peer range vs reality, StrictMode semantics, concurrent rendering, Suspense usage (`use()`, prerender), react-dom/static + hydrateRoot assumptions, RSC-world importability
needs: — (best after scope-and-island lands — SI-03/06 deepen the Suspense surface)
status: open
disposition: cut 2026-07-19; production-review lens 7 (added at cut — README §Decisions)
---

# REV-07 — React compatibility & rendering modes

## Problem

rati leans on specific React machinery: `useSyncExternalStore`, `use()` suspension,
`react-dom/static` `prerender`, hydration's boundary-abandonment retry (the SSR-error
baseline *depends* on it). Each is version- and mode-sensitive. The peer range should be a
tested claim, not an aspiration — and the semantics under modes rati doesn't itself run
(a consumer's `<StrictMode>`, transitions, `Activity`/offscreen if in range) should be
known, stated, and pinned.

## Scope

1. **Peer range, tested.** What does `peerDependencies` claim (coordinate with REV-03)?
   Install the range endpoints in a scratch consumer (oldest claimed React + newest
   stable) and run a representative suite subset against each — the supported range
   becomes an executed fact. If only one major is realistically supported, the finding is
   "narrow the range", which is cheaper than a stranger's broken install.
2. **StrictMode semantics** (fence with REV-04: leaks are theirs, semantics are ours):
   double-render/double-effect visible consequences — do loads fire twice? sources
   attach/detach/reattach cleanly with no visible flicker in phases? `strictModeLifecycle`
   suite extended to any surface it doesn't cover (controls, hydration, router islands).
3. **Concurrent rendering:** interrupted/replayed renders against the mandala's commit
   discipline (buckets committed in effects vs render — torn reads possible?), uSES's
   tear-avoidance actually leaned on correctly, a `startTransition`-wrapped navigation
   (consumers will do it even though rati doesn't) — define and pin what happens.
4. **Suspense contract:** `use()` on rati's promises under re-render churn (cached
   correctly per bucket?), nested Suspense boundaries between island and its slots, and
   the documented reliance on boundary-abandonment client retry — pin the React behaviors
   rati's SSR-error baseline assumes, so a React upgrade that moves them fails a named
   test instead of a user report.
5. **RSC-world importability** (direction only — rsc-support.md is postponed): can a
   Next/RSC app at least *import* rati in client components without the server bundler
   choking (`"use client"` expectations, conditional exports)? Not RSC support — just "does
   the door stay open"; findings feed the postponed record, not new scope.
6. **The version-skew story stated:** react-dom/static on the server + react-dom/client on
   the client at different patch levels (deploy skew) — does hydration's payload format
   assumption hold? One paragraph of documented position, driven by one experiment.

## Boundaries

- `src/data/` excluded; MobX version compatibility is out (optional peer, `rati/mobx`
  reviews with data extraction).
- No new mode *features* (no transition-based keepStale revival — Option B stays
  rejected); this lens states and pins behavior, it doesn't redesign.
- Framework-integration matrices (Next/Remix/Expo) beyond §5's importability smoke are out.

## Verify

- The range-endpoint runs' results recorded (versions × suite outcome) in the findings
  note; the peer range updated if the executed fact disagrees with the claim (that fix is
  in-session, with REV-03 coordination noted).
- New/extended mode pins land in the existing suites' style; `yarn ci` green.
- The assumptions-of-React list (§4) exists as pinned tests or a documented internals note
  — each assumption either tested or explicitly stated, none implicit.
