---
area: packages/rati/src/router
needs: —
status: done
disposition: —
---

# RF-01 — router hardening: the pre-cut review's four findings

## Problem

The review that cut this effort (README §"Review findings") found four concrete defects.
They are fixed first because the fuzz model would otherwise disagree with the engine on
day one — most directly on the param round-trip, where the model's "what you put in is
what the component gets" expectation is the natural contract and the engine violates it.

## Scope

1. **Param codec** (README finding 1; the entry-gate decision). If decided as symmetric:
   `getPath` runs each interpolated param value through `encodeURIComponent`;
   `getActiveRoute` runs each matched group through `decodeURIComponent`. Pins: a value
   with a space/slash round-trips through `getPath` → navigation → component props; a
   Base64Uuid value is byte-identical before and after (the jnana shape must not move).
   Sweep the existing suites for pinned URL strings the change moves and review each
   against the contract.
2. **Boundary-aware substitution** (finding 2): replace the `path.replace(':' + key, …)`
   substring scan with a parameter-boundary match (the same `:(name)(/|$)` shape
   `buildPathRe` tokenizes with), so `:id` never eats `:idx`'s prefix. Pin: a route table
   where the shorter name's segment follows the longer one's.
3. **Unknown-name error** (finding 3): `getPath` on a name absent from the table throws a
   framework-shaped error naming the route, instead of the non-null assertion's TypeError.
   Pin: the message.
4. **History dispose** (finding 4): give `History` a way to detach from the DOM —
   `createBrowserHistory`'s `popstate` listener currently outlives every consumer. The
   likely shape: a `dispose()` on the returned object, called from
   `RouterStore.dispose()` when the store *created* the history (an injected one belongs
   to the caller). Pin: two sequential stores in one jsdom window; disposing the first
   leaves exactly the second responding to popstate.

## Boundaries

- Semantics decisions are the user's (B1 entry); this item implements what was decided.
- Public docs: `docs/public/` routing pages document params — keep them in sync with the
  codec decision (the round-trip promise is user-facing).
- No fuzz code here; RF-02 builds on the decided behavior.

## Verify

- `yarn ci` green (all stages — the pinned-string sweep shows up in `test`).
- Each fix's pin goes red with the fix reverted (executed once, noted in the test).
