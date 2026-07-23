---
area: packages/rati/src/mandala/{resolver.tsx,mandala.tsx,controls.ts,channel.ts}, src/island/island.ts, src/router/route.tsx, docs
needs: B1 merged (shares resolver files with SI-01/SI-04)
status: done
disposition: cut 2026-07-19 from scope-and-island-directions.md §2; Option A decided at cut (engine-owned kept props, not React transitions); status folds into `useScopeControls` (no new hook) — README §Decisions
---

# SI-03 — `keepStale` + the status surface on `useScopeControls`

## Problem

On a param change or `refresh()` the island tears down and re-renders the loading slot,
blanking content the user was just reading. The better UX for most re-resolves is
stale-while-revalidate: keep the previous content visible, marked stale, until the new
resolution commits. Separately, `useScopeControls` (`mandala/controls.ts`) exposes only
`refresh` today — the subtree has no way to read the island's phase, so even a hand-rolled
stale treatment has nothing to hook.

## Scope

1. **The kept bucket.** `keepStale: true` on `island()` / `RouteOptions`: during a
   re-resolution (param-change `treeKey` remount, `refresh()`), the island keeps rendering
   the last committed resolved props instead of the loading slot, swapping when the new
   bucket commits. The mandala already holds the committed bucket — this is a controlled
   extension of that (research doc Option A). First load is unchanged (nothing to keep).
   An error during a stale re-resolve renders the error slot (honest failure beats stale
   content masquerading as current) — pin this choice.
2. **The status surface on `useScopeControls`.** The controls object gains:
   - `phase` — the island's aggregate phase (shape decided in-item; at minimum
     `'loading' | 'ready' | 'error'`, with the re-resolving-while-stale state
     distinguishable);
   - `isStale` — true iff kept props are being shown during a re-resolution;
   - `retry` — the error-slot retry, folded in so a subtree can offer retry without being
     the error slot.
   Works without `keepStale` too (phase is meaningful for any island). Type inference off
   the scope argument stays intact; the existing framework-shaped errors
   (`controls.ts:64,70`) keep their shape.
3. **Interaction with inputs:** kept props were resolved for the *previous* params. The
   component's props swap only on commit — document that under `keepStale` the subtree can
   briefly see old props with a new URL (that is the feature); `isStale` is the flag that
   says so.
4. **SSR:** inert — the server never re-resolves. Pin no dehydration change.
5. **Docs:** guide (a loading-states section teaching delay + stale + status as one story)
   and reference (`useScopeControls`'s full surface, island/route options). Internals: the
   kept-bucket mechanism (`docs/current/internals.md`).
6. **Gallery:** extend the refresh/error page (or add one) showing dimmed stale content on a
   param change — the maintainer's semantics review (plan B2 checkpoint) reads it.

## Boundaries

- No React-transitions implementation (Option B is rejected, not deferred).
- No per-load staleness; the aggregate bucket is the unit.
- Default behavior (no `keepStale`) must be bit-for-bit what ships today — the mandala fuzz
  suite is the tripwire (plan §Orchestration).
- `loadingDelayMs` is SI-02's; don't build the timer here, but leave the commit path shaped
  so a delay can gate the slot without re-touching the bucket logic.

## Verify

- `yarn ci` green, including the deep fuzz budget (the fuzz harness never sets `keepStale`,
  so any fuzz movement means default behavior changed — stop and report).
- Pins: param-change re-resolve keeps content and flips `isStale`; commit swaps props and
  clears it; error during stale re-resolve shows the error slot; `refresh()` behaves the
  same; first load unchanged; `phase`/`isStale`/`retry` correct through a full
  pending→ready→stale→ready→error cycle; controls still throw their framework-shaped errors
  when unmatched.
- Type test: the controls object's type is inferred from the scope argument (no `any` leak).
