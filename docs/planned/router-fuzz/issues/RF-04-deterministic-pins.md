# RF-04 — deterministic pins: audit the 21 suites, add what's missing

area: packages/rati/src/__tests__/router
needs: RF-02
disposition: —

## Problem

The router already has 21 deterministic suites; unlike the mandala (whose pins were mostly
new), the risk here is *duplication*. This item audits the existing coverage against the
pin list below and adds only the genuinely missing ones — each with a kill note, executed
once and reverted (the mandala-fuzz lesson: an unexecuted kill note is a guess; MF-05
found a pin passing its kill for the wrong reason).

## Scope

The pin list — for each, first find whether an existing suite already pins it (file the
audit in the completion note), then add what's missing:

1. **Skip-marker staleness across POP**: `navigate({ keepCurrentRoute })`, navigate away,
   POP back onto the marker entry → re-resolves (the counter moved). Kill: compare the
   marker against the marker string only, ignoring the counter.
2. **Cross-session marker**: a marker with a foreign `sessionId` (a restored tab) is
   stale on arrival. Kill: drop the session id from the comparison.
3. **Redirect depth/loop**: the cycle stops at `MAX_REDIRECT_DEPTH`, logs the trail, and
   renders the last route's component; `redirectHops` resets on the next fresh navigation.
   Kill: drop the `redirectDepth === 0` trail reset.
4. **Hydrated-state drift**: `hydratedState` naming a route absent from the client table
   falls back to matching the URL (the `seedFromHydratedState` fallback), not a blank.
   Kill: return early instead of falling back.
5. **State-only navigation**: two entries sharing a URL, differing in per-entry state —
   traversal between them re-resolves; shallow-equal state does not. Kill: make
   `shallowEqualState` reference equality.
6. **Basename edges**: `pathname === basename` matches `/`; a pathname *outside* the
   basename falls through to the catch-all; `getPath` prepends, `isPath` strips.
7. **Scroll-restoration keys**: POP restores the saved entry's position, an unvisited
   entry falls through to top, a hash anchor wins over top — as key bookkeeping (jsdom
   pixels are fake; assert which branch ran).
8. **`preloadRoute`**: matches through the basename, strips query/hash, no-ops on a
   non-lazy component, dedupes.

## Boundaries

- Independent of RF-03 (parallel lane; touches `__tests__/router/`, not the fuzz files).
- Existing suites are edited only to *extend* — a pin that exists stays where it is; the
  audit note says where.
- The altitude rule binds.

## Verify

- `yarn ci` green; every added pin's kill executed red and reverted (noted inline, recipe
  in the completion note).
