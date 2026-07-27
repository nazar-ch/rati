---
area: packages/rati/src/router — router.ts (interface), store.ts
needs: nothing
status: done
disposition: fixed 2026-07-27 — back/forward/go forwarded onto Router/RouterStore as thin pass-throughs (history stays unexposed); nazar.ch:FND-03 reverts to the router method on the next release
---

# FND-04 — the Router surface lost history traversal (back/forward/go) with no replacement

## Problem

`Router` (router.ts) has no `back()`, `forward()`, `go(delta)`, and no `history` accessor.
All three exist on the `History` abstraction one layer down (history.ts:44-48) and are
implemented by both histories, but nothing on the public surface reaches them.

This is a **regression, not a missing nicety**. In 0.6.2 `RouterStore` was exported from
the main entry with a public `history: History` field, so `router.history.back()` was
sanctioned public API. 0.6.3 took `RouterStore` internal and `Router` did not carry the
capability across.

Found by the 0.6.3 consumer migrations (2026-07-27): nazar.ch's photo viewer closed itself
with `router.history.back()` and the typecheck refused it — `Property 'history' does not
exist on type 'Router'`. It now calls `window.history.back()` and tracks the revert as
`nazar.ch:FND-03`.

## Why it matters

An app that needs a back-step has two options, and both are bad for rati: bypass the
router (`window.history`, which drops the memory-history case, so SSR and tests diverge
from the browser) or cast back to the internal store (defeating the point of making it
internal). "Close this and go back" is ordinary app work, not an exotic requirement.

The omission also looks deliberate from outside — `dispose()` made the cut and `back()`
did not — so a consumer cannot tell whether to work around it or wait.

## Direction

Additive, no breaking change: forward the three `History` methods onto `Router` and
`RouterStore`. Prefer the three named methods over re-exposing `history` — the field
handed out the whole abstraction (including `listen`/`replace`, which would let an app
desynchronize the router from the URL), and forwarding is what the routing-aware wrapper
should own.

Open question for the maintainer: whether traversal should participate in the router's
own navigation choreography (a `go()` that resolves before the popstate lands) or stay a
thin pass-through. A pass-through matches today's behavior — the histories already notify
the store through their listener — and is the smaller claim.

## Scope

1. Add `back()`, `forward()`, `go(delta: number)` to the `Router` interface with doc
   comments, and implement them on `RouterStore` as forwards to `this.history`.
2. Test against **both** histories — the browser one and `createMemoryHistory` — so the
   SSR/test path is pinned, not just the browser: a `go(-1)` after two pushes resolves the
   earlier route and updates `activeRoute`.
3. Reference: the `Router` table in reference.md gains the three rows.

## Boundaries

- Do not re-expose `history` on the public surface; forward the methods.
- No change to how the histories themselves notify the store.

## Verify

- `yarn ci` green.
- nazar.ch's `PicturesPage.tsx` can revert `window.history.back()` to the router method
  (that repo's FND-03 is the downstream half).
