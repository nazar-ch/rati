---
area: packages/rati/src/router, packages/rati/src/__tests__/fuzz
needs: RF-02
status: done
disposition: Scope §2 was superseded mid-item — `%2E` is no escape from dot-segment normalization, so nothing encodes; the shipped shape is *document the limitation* (README §Findings, 2026-07-16 RF-06), re-taken at the round-2 review as *refuse* (RF-08). §Verify's "a dot-only value round-tripped" counter became "a param value carrying dots round-tripped" for the same reason. The text below is the cut-time spec, kept as written.
---

# RF-06 — router hardening 2: the three edges RF-02's foundation found

## Problem

RF-02 confirmed three product edges by hand and stepped its arbitrary around them
(README findings, 2026-07-16), because each was a decision. The decisions are taken
(maintainer, 2026-07-16); this item implements them and lifts the fuzz exclusions, so
RF-03's alphabet starts from an engine and a model that agree everywhere.

## Scope

1. **A self-redirect is a loop of length 1** (decided: report + render). Today
   `route('/self', …, { redirect: { to: '/self' } })` leaves the *previous* page
   rendered at the new URL: `setPath` writes `this._path` before following, so the
   nested `setPath` takes the same-path early return and the depth guard never fires.
   Fix in `setPath`: before following a matched redirect, resolve the target and
   compare its pathname (basename-stripped, search/hash excluded — a same-path
   different-search target is the same trap) against the pathname being resolved;
   equal → the loop-detected branch: log the trail, render the route's own component.
   That is the contract `route()` already documents ("the component shows only if a
   redirect loop is detected") — the 1-cycle now behaves like the capped 2-cycle,
   minus the wasted hops. Pin: navigate `/home` → `/self`; the URL reads `/self`,
   the self route's component renders, the loop is reported, one hop recorded.
2. **Dot-only param values encode** (decided: close the codec's last hole).
   `getPath({ id: '..' })` builds `/users/..`, which the URL parser normalizes away —
   the entry lands on `/` and the root route renders; `.` behaves the same. In
   `getPath`'s substitution: a value that is exactly `.` or `..` interpolates as
   `%2E` / `%2E%2E` (the decode side already round-trips them). Pins: both values
   round-trip through `getPath` → navigation → component props; a value merely
   *containing* dots (`a.b`, `..x`) stays untouched.
3. **String redirect targets stay verbatim — documented** (decided: no behavior
   change). With a `basename`, a bare string target (`to: '/b'`) leaves the mount
   point (`/admin` + `/a` → URL `/b`) and only renders via `stripBasename`'s
   catch-all fall-through. The contract is symmetric with `getPath`'s string rule and
   stays; the docs get the explicit line: under a basename, a string target must
   include it — write what the URL bar should say. Where redirects are documented in
   `docs/public/` (and `RouteRedirect`'s doc comment, which already says "used
   verbatim" — sharpen it with the basename sentence).
4. **Lift the fuzz exclusions the fixes obsolete.** The arbitrary's target pool
   admits self-targets and the model grows the rule (self-target → loop report +
   the route renders); the value pool gains `.` and `..` with the model's `buildPath`
   mirroring the dot-segment encoding. The string-target draw keeps writing the
   basename in (that is now the *documented* shape, not a dodge — update the comment
   at the draw to say so).

## Boundaries

- The decisions above are settled; no re-litigating semantics in-item.
- No new alphabet verbs, no traversal — RF-03 owns those. This item only makes the
  smoke property's ground complete.
- The altitude rule binds, as everywhere in this effort.

## Verify

- `yarn ci` green; each fix's pin red with the fix reverted (executed once, noted at
  the test).
- The lifted exclusions hold at `FUZZ_RUNS=500`; the non-vacuity counters gain
  entries for the new shapes (a self-redirect was entered; a dot-only value
  round-tripped) so the pool can't silently starve them.
