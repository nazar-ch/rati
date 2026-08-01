---
area: docs/public/ssr.md, docs/internals.md
needs: —
status: done
disposition: —
---

# SSR-10 — docs tail from the consumer migrations

## Problem

Two findings are documentation, not code, and the failure modes are silent:

- **A `!isSsrBuild` plugin guard inverts under the plugin's build** (SSR-05). Once
  `ratiSsr` opts into the app builder, `isSsrBuild` is `false` on every config call —
  the guard stops excluding and the client-only plugin quietly runs on the SSR bundle.
  The wrong artifact is the only symptom. The fix is
  `applyToEnvironment: (env) => env.name === 'client'`.
- **React 19.2 gates the Suspense reveal on `requestAnimationFrame`** (SSR-04), which
  never fires in a hidden tab — a headless/background browser leaves boundaries
  un-revealed forever and a healthy page looks broken. This cost SSR-04 real time (it
  made the title flash look permanent).

## Scope

1. `docs/public/ssr.md` §Build: a migration note — configs that branch on `isSsrBuild`
   must switch to `applyToEnvironment`, with the jnana shape as the example.
2. The hidden-tab/rAF note where SSR verification guidance lives: check
   `document.hidden` before believing a hydration failure; verify in a visible tab.
   Public docs if there's a verification-shaped spot, `docs/internals.md` testing
   pointers otherwise.

## Boundaries

Docs only; no code. (The whole-document ⇄ CSR-fallback exclusivity is already
documented and SSR-12 owns changing it.)

## Verify

Proofread in place; `vp lint` unaffected (Markdown is excluded from oxfmt — edit by
hand).
