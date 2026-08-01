---
area: the trust boundaries: ssr/{payload,html,renderApp,headTags}, mandala/hydration, server/{requestHandler,node} (static files, headers, redirects), router URL/param handling, vite plugin dev server
needs: —
status: open
disposition: cut 2026-07-19; production-review lens 5
---

# REV-05 — security

## Problem

rati now ships a server. Every place attacker-influenced bytes (the request URL, params,
load results, error messages) meet HTML, headers, or the filesystem is a boundary someone
will eventually probe. Pieces have been hardened point-wise (payload escaping per CORE-1;
the `//host` open-redirect closed in the RF-07 post-close round — found once, so the class
is live); no session has walked all the boundaries as its whole job.

## Scope

1. **HTML injection via the hydration payload.** The dehydrated JSON carries load results —
   attacker-influenced when a load echoes request data. Verify the escaping
   (`<` `>` `&` U+2028/U+2029, `</script>` sequences) against hostile fixtures *through the
   real pipeline* (a load returning `"</script><script>alert(1)</script>"` end-to-end, not
   a unit test of the escaper). If SI-06 landed, the error wire section gets the same
   treatment (error messages routinely embed request input).
2. **The document assembly** (`ssr/html.ts`, `headTags`): title/meta content escaping
   (a `useTitle` fed from a param), attribute contexts, the template seams
   (`virtual:rati/assets` interpolation).
3. **Headers & redirects.** `requestHandler`'s result-kinds → HTTP: `Location` values
   (re-audit the RF-07 fix's coverage: other spellings, header-splitting via CR/LF in any
   header rati sets from derived values), status derivation fed by hostile URLs.
4. **Static file serving** (`server/node.ts`): traversal (`..`, encoded, backslash,
   null bytes), symlink behavior, MIME table correctness for active types, and the same
   for the *dev* server path (`vite/ratiSsr.ts`) — dev is exposed on LANs.
5. **Router surfaces:** decoded params flowing into `getPath`/redirect functions (the
   RF-07 chain generalized), `Link`/`Navigate` with `javascript:`-shaped strings, `state`
   round-tripping through history serialization.
6. **Prototype pollution shapes:** hydration/state JSON revived into objects that get
   merged (`__proto__` keys through payload → any `{...spread}` into config).
7. Anything found: fix small (an escape, a guard — with its hostile-fixture pin) or file
   with severity; a real exploitable in the *published* surface is worth flagging to the
   maintainer immediately in the findings note, not just appended.

## Boundaries

- `src/data/` excluded; app-level auth/CSRF is consumers' business — rati's job is that
  *its* plumbing introduces no injection or traversal.
- No dependency-audit/supply-chain scope (near-zero deps by design; note exceptions).
- DoS hardening (request limits, exhaustion) is out except where an existing guard claims
  it (the redirect depth cap: verify it holds server-side).

## Verify

- Hostile-fixture pins for every boundary exercised, committed with the fixes or attached
  to filed findings (the fixture *is* the repro).
- The RF-07 open-redirect pins re-executed once (regression check on the class).
- `yarn ci` green after fixes.
