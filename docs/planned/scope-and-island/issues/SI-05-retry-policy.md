---
area: packages/rati/src/mandala/{boundary.tsx,resolver.tsx}, src/island/island.ts, src/router/route.tsx, docs
needs: SI-03 (an automatic retry must be visible through the phase surface, not a frozen error slot)
status: done
disposition: cut 2026-07-19 from scope-and-island-directions.md §2 (the doc marked it wait-for-need; cut anyway — README §Decisions)
---

# SI-05 — automatic retry policy

## Problem

`error` slots get a manual `retry` today, so every consumer with flaky network writes the
same retry button. An optional per-island automatic policy removes that boilerplate for
transient failures. The retry counter already exists in the boundary machinery — the policy
is a driver for it.

## Scope

1. **`retry?: { count: number; backoffMs: number }` on `island()` / `RouteOptions`.**
   Applies only to `error.code === 'failed'` — never `not-available` (a 404 retried is
   still a 404; the research doc is explicit). Backoff: fixed or exponential — decide
   in-item, document the choice; `backoffMs` names the base either way.
2. **Semantics:** on a qualifying error, schedule a re-resolve after the backoff; stop after
   `count` automatic attempts and render the error slot with manual `retry` still armed
   (which resets the automatic budget — a human clicking is new information). During an
   automatic retry the island shows: the loading slot, or kept content if `keepStale` —
   the same presentation rules as any re-resolve; `phase` says retrying is happening
   (exact shape from SI-03's review).
3. **Timer discipline:** pending retry timers cancelled on unmount, on param change (new
   bucket, fresh budget), on manual retry.
4. **SSR:** no automatic retries server-side — one attempt per request; the policy is
   client-only. Pin it.
5. **Docs:** reference (option + the `failed`-only rule); guide error-handling section gets
   the one-liner.

## Boundaries

- No per-load retry, no retry on `not-available`, no jitter/abort integration beyond what
  SI-01 already gives a re-resolve (each attempt is an ordinary re-resolve — it must abort
  the previous attempt's signal like any other).
- Default stays no-retry; absent option means today's behavior exactly.
- Don't grow a global config — per-island only.

## Verify

- `yarn ci` green.
- Pins: `failed` error retries `count` times at the configured cadence (fake timers) then
  settles into the error slot; `not-available` never auto-retries; manual retry after
  exhaustion works and resets the budget; unmount mid-backoff leaks no timer; success on
  attempt N renders content and stops the policy; with `keepStale`, content stays visible
  through the retry cycle.
