---
area: packages/rati/src/router/store.ts (getPath), docs/public/reference.md, packages/rati/src/__tests__/fuzz (pool comments)
needs: — (independent)
status: done
disposition: cut 2026-07-16 (round-2 review); decision taken — throw
---

# RF-08 — getPath refuses a dot-only param value

## Problem

The codec's one unrepresentable value, third take. RF-02 found it (`getPath({ id: '..' })`
builds `/users/..`, the parser resolves it away, the entry lands on `/`); RF-06 tried to
encode it and proved no encoding survives (`%2E` is read as a dot in every spelling — the
platform's own anti-traversal stance), so the decision was re-taken as *document the
limitation*. The round-2 review re-took it once more, against what the field does: React
Router's `generatePath` doesn't percent-encode at all, Vue Router's encoder leaves dots
alone, TanStack escapes with `encodeURIComponent` (identity on dots) — every one of them
silently misnavigates on a dot-only value. Documenting matches the field; it just doesn't
help the caller, who still lands on the wrong page with nothing in the console.

Decision (maintainer, 2026-07-16): **throw**. `getPath` is the single choke point, its
contract is "a URL that round-trips these params back to the component", and for a
dot-only value no such URL exists — both silent options navigate somewhere the caller
didn't ask. RF-01 set the precedent: unrepresentable inputs get a framework-shaped error
(the unknown-route name). The trade, accepted: a `<Link>` whose param is user data equal
to `..` now throws at render (an error boundary's business) instead of rendering an href
that lands on `/`.

## Scope

1. **`getPath` throws on a param value that is exactly `.` or `..`** — the error names
   the param, the route, and the fix (put arbitrary values in the query string, or map
   them to an id; the same guidance reference.md already gives). Values merely
   *containing* dots (`a.b`, `..x`) stay untouched — the boundary is "the whole segment
   is dots", unchanged from RF-06.
2. **reference.md §Routing**: the "no URL to carry it" paragraph keeps its facts and
   changes its ending — the value is refused rather than silently resolved away.
   `getPath`'s doc comment and the store's `%2E` comment updated to say *refused*, still
   naming the `%2E` trap so nobody re-files encoding as the fix.
3. **Fuzz**: the pool's "deliberately absent" note updates from "documented as
   unrepresentable" to "refused by contract"; a deterministic pin per value (`.`, `..`)
   asserts the throw and its message names the route. The pool keeps `a.b`/`..x` as the
   live half.

## Boundaries

- Decode-side behavior is untouched: a malformed escape in an inbound URL still warns
  and hands the raw segment through (that is hostile network input; `getPath` is the
  app's own call — the asymmetry is the point).
- No attempt to encode (`%2E`, double-encoding) — RF-06 closed that road and the comment
  stays as the marker.

## Verify

- `yarn ci` green; the pins red with the throw reverted (executed once, noted at the
  test).
- The existing dot-carrying pins (`a.b`, `..x` round-trip) pass unchanged.
