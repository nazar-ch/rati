---
area: packages/rati/src/data — query.ts and every caller (+ reference.md, internals.md)
needs: nothing; DATA-13 lands on the renamed surface (same leg)
status: done
disposition: cut 2026-07-25 from the second-round migration feedback (breaking; pre-1.0 and allowed)
---

# DATA-12 — rename `Query.load()` → `prime()`

## Problem

Two of the second wave's four migration legs wired a UI button to `query.load()` and got a silent
no-op — `load()` is the idempotent ensure ("fetch only if absent"), and the name reads like a
gesture. The distinction itself is valuable and stays (mount ensures, gestures refresh — the first
wave called it the thing that made `JobsListStore` better than what it replaced); the *name* is the
trap.

Naming survey (recorded for posterity): TanStack `ensureQueryData`, SWR `preload`, RTK Query
`prefetch`, Redux-era `fetchIfNeeded`. `ensure` overclaims ("will not ensure it's correct — it
actually fetches if needed"), `preload`/`prefetch` connote before-need, `trigger`/`activate` read as
force-fire/lifecycle. Maintainer's pick: **`prime()`** — short, priming an already-primed pump is
naturally a no-op, claims nothing about freshness, and reads obviously wrong wired to a button.

## Scope

1. `query.ts`: `load()` → `prime()` — the method, the `Query` interface, the design-comment block,
   and the internal call sites (`source()`'s attach path, debounce's "load never debounces" notes →
   "prime never debounces").
2. Every other reference in the package: collection (its facade forwards `prime` — DATA-13 owns the
   facade shape, but if this lands first, `collection.query.prime()` still renames), pagedCollection
   if it touches `load`, tests, test-d files.
3. Docs: reference.md `rati/data` section, guide.md data sections, internals.md — every
   `load()`-the-ensure mention. Watch for collisions with the *scope*'s `.load({…})` levels, which
   keep their name (different concept, different surface; a one-line disambiguation note in
   reference.md where the two meet is welcome).
4. The jnana adoption record (filed separately in jnana's tracker) carries the consumer-side rename;
   nothing to do here beyond the release notes line.

## Boundaries

- `refresh()`, `set()`, `patch()`, `reset()` unchanged.
- Scope's `.load({…})` builder keeps its name — this rename is the data package's ensure only.
- No behavior change of any kind; this is a pure rename.

## Verify

- `yarn ci fmt lint typecheck test` green.
- `rg -w 'load\(' packages/rati/src/data packages/rati/src/__tests__/data` shows no remaining
  ensure-sense uses; docs greps likewise.
