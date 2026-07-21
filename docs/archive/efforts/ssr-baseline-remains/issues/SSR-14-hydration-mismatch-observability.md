---
area: packages/rati/src/__tests__/router/hydration.test.tsx (and any other console-only hydration assert)
needs: — (independent)
status: done
disposition: cut 2026-07-16 (round-2 review), from SSR-12's finding
---

# SSR-14 — hydration mismatches must be observable to the suites that claim them

## Problem

SSR-12 measured it: React reports a recovered hydration mismatch to
`onRecoverableError`, whose default is `reportGlobalError` — *not* `console.error` — so
a `vi.spyOn(console, 'error')` assertion passes straight through a real mismatch. An
injected text mismatch in `router/hydration.test.tsx`'s `ssrThenHydrate` left all 391
tests green while the helper's comment (`:105`) claims the opposite, and four of that
suite's tests exist *for* the console-clean claim. These are the suites underwriting the
baseline's hydration story. `ssr/wholeDocument.test.tsx` had the same hole and was fixed
in-item (its mounts now pass their own `onRecoverableError` and assert it never fired);
`mandala/islandSsrSources.test.tsx:337` already knows the channel.

## Scope

1. Every hydrating mount in the router/mandala test tree that claims "no mismatch"
   passes an `onRecoverableError` and asserts it never fired — the known one-liner per
   mount, applied where the claim is made.
2. Re-run the deliberate-mismatch canary from SSR-12's finding: inject a text mismatch
   into `ssrThenHydrate` and confirm the suite now goes red (that is the pin for the
   pins).
3. **Room to be surprised is the point**: the assertion has never worked in that suite,
   so turning it on may surface real mismatches. Anything found is a product finding for
   the README, not something to silence in-item.

## Boundaries

- Test-strength only — no engine changes unless step 3 finds a real mismatch, which is
  then filed (and fixed only if it is a slip rather than a decision).
- Vitest's "Unhandled Error" reporter noise for *deliberately* mismatching tests is
  handled the way `islandSsrSources.test.tsx:337` already does it, not by global
  suppression.

## Verify

- The injected-mismatch canary red; the suite green with it removed; `yarn ci` green.
