---
area: packages/rati/src/mandala/resolver.tsx, src/testing/ssr.tsx
needs: nothing (independent; found by the 2026-07-19 pre-DX-05 review)
status: done
disposition: cut 2026-07-19 from the review's engine finding
---

# DX-08 — SSR error-channel hardening: per-collector rejection dedup + a prerender settle budget

## Problem

Two ways the SSR kit's error channel can go quiet without saying so:

1. **The rejection dedup is global, the collectors are not.** `resolver.tsx` guards
   rejected-promise handler stacking with a module-global `recordedRejections` WeakSet keyed
   on promise identity. The guard is correct for its original purpose (a suspended level
   re-renders, the same promise must not attach a second `collectError` handler), but it
   outlives the render: a *second* `ssrRender` of a tree that reuses the same rejected
   promise instance (a module-level promise; a promise captured across two renders in one
   test) skips `collectError` entirely — the second `ServerRender.errors` is silently empty,
   undermining the documented "the server's 404/5xx signal". Fresh promises per render are
   unaffected, which is why nothing notices today.
2. **A never-settling marked source hangs the prerender with no rati-side diagnostic.**
   `source.ts` promises "budgets belong to the prerender helper"; the testing kit is now
   that helper for tests, and a `controllableSource({ ssr: true })` with no `loads` that
   nobody drives runs the test into the runner's timeout with a generic message.

## Scope

1. Key the rejection record per collector (e.g. a `WeakMap<collector, WeakSet<promise>>`,
   with the current global WeakSet retained for the no-collector/client path), so each
   `ssrRender`'s collector sees every rejection once. The existing behavior *within* one
   render (no handler stacking across re-renders) is a pin — keep it tested.
2. A `settleTimeout` (name at implementer's discretion; plain English) option on
   `prerenderToString`/`ssrRender` that fails the drain with a message naming the still-
   pending suspense (or at least the elapsed budget and the likely cause — an undriven
   marked source / a hung load). Off by default if a good default is contentious; the value
   is the *message*, not the enforcement.
3. A regression test for each: two sequential `ssrRender`s sharing one rejected promise
   instance both report it in `errors`; a deliberately hung marked source fails with the
   named message instead of the runner timeout.

## Boundaries

- No behavior change for the production `renderToHtml`/`renderApp` path beyond what the
  per-collector keying inherently touches; the settle budget is testing-kit surface only.
- Not a general SSR-timeout feature for the server kit — that stays the engine's stated
  non-goal.

## Verify

- `yarn ci` green; the two new pins pass; the existing suspended-level re-render dedup pin
  still passes.
