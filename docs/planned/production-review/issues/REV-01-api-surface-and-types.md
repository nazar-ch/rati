---
area: packages/rati/src/main.ts + every entry barrel (mobx, data*, ssr, server, vite, debug, testing), the built dist/*.d.ts, docs/current/public/reference.md as the claimed contract
needs: — (best after scope-and-island + testing-and-dx land)
status: open
disposition: cut 2026-07-19; production-review lens 1 (*data excluded — see README)
---

# REV-01 — public API surface & types

## Problem

The published surface is what strangers program against and what semver binds. Nobody has
audited it as a whole: what `main.ts` and the entries actually export versus what
reference.md claims, what leaked that shouldn't have, whether names/options/ordering are
coherent across the API, and what the built `.d.ts` files really present (tsgo emits them;
nobody reads them).

## Scope

Read the entire exported surface, then hunt:

1. **Export audit.** Every export of every entry: is it meant to be public? Is anything
   internal reachable (engine types, helper functions, the `mandala` name leaking)? Is
   anything documented in reference.md but not exported, or exported but undocumented?
   Type-only exports marked as such (`export type`)? The barrel-discipline rule (no barrels
   beyond `main.ts`) still true?
2. **Coherence.** Options bags vs positional args used consistently; the same concept named
   the same everywhere (slots, phases, `dispose` vs `detach` vs `teardown`); plural/single
   and `on*` conventions; default values stated and consistent; the plain-English naming
   rule (no coined terms) holding across newer surface.
3. **The built types.** Run `vp run rati#build`, read `dist/*.d.ts` as a consumer:
   inference survives (no `any` where the source had precision), no `src/`-relative or
   internal import paths leak, the `RatiUserTypes` augmentation story works from dist
   (write a scratch consumer against the built package — augmentation + `getPath` +
   `useScope` inference end-to-end; the `rati-dev` condition must not be what makes it
   work).
4. **Generics ergonomics.** The user-facing generic signatures (`scope`, `island`,
   `useScope`, `input`): error messages a wrong-typed consumer sees (provoke a few:
   mismatched scope/component props, wrong input type) — are they decipherable or
   200-line-conditional-type walls? File the worst as findings even without a fix.
5. **JSDoc.** Public symbols carry doc comments that match reference.md (hover text is
   API); flag contradictions.

## Boundaries

- `src/data/` excluded (its surface reviews with DATA-04's extraction decision).
- Wording quality of docs prose is out of scope; reference.md is used as the claimed
  contract, and *mismatches* are findings.
- Renames are findings, not fixes — every rename is a breaking decision for the close-out,
  except a clearly-internal accidental export, which may be unexported in-session (with a
  note, and a check that neither examples nor jnana consume it).

## Verify

- The scratch dist-consumer check from §3 committed (as a findings-note artifact or a real
  test if it earns one).
- `yarn ci` green after any in-session fix; each fix pinned.
- Findings filed in the effort README with repro (for type findings: the code + the error
  text observed).
