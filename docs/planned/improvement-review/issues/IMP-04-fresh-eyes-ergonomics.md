---
area: docs/research/ (output); the whole public API as the subject
needs: — (best after scope-and-island lands)
status: open
disposition: cut 2026-07-19; improvement-review direction 4
---

# IMP-04 — fresh-eyes ergonomics

## Problem

The API was designed by its one user, iteratively, against one app — the ideal conditions
for local maxima. REV-01 (production-review) audits the surface for *coherence as it
stands*; this session asks the unconstrained question instead: knowing everything the
project now knows, what would the API look like designed today? Not to rewrite it — to
find the handful of places where a breaking change *before* going public is cheap and the
same change after is impossible. Public release is the last moment this question is this
inexpensive.

## Scope

1. **Re-derive, then diff.** From the design intent (`CLAUDE.md` §Mental model, the
   naming record's rules) sketch the API a fresh designer would build for the same goals —
   then diff against the real one. Every divergence is either a defensible scar (record
   why) or a proposal. Areas the cut expects tension: the `scope({inputs}).load({…})`
   builder's shape (levels as chained calls — what about level naming, reordering,
   conditional levels?); `island()`'s config-object vs the router's positional
   `route(path, name, component, options)` asymmetry; `provide()`'s factory semantics;
   `input<T>()`'s phantom-type mechanics; the `useScope`/`useRouteContext`/
   `useScopeControls` trio (three hooks, one channel family — right cut?); options
   naming across island/route (`loading`/`error`/`wrapper`/`ssr`/`keepStale`/… — one
   vocabulary?).
2. **The error-message experience as design.** Where the API's shape *causes* bad errors
   (generic inference walls, wrong-arity confusion), the proposal is a shape change, not
   copy — coordinate with REV-01's findings if they exist by then (read them; don't
   re-derive).
3. **Severity-tag every proposal:** breaking-now-cheap / breaking-later-possible /
   additive. The breaking-now-cheap list is the session's headline — it is the last-call
   list; deliberately small and hard-argued (a rename parade is this session failing;
   naming.md's decisions stand unless a proposal shows a *new* cost).
4. **Precedent checks** where a shape is contested: how the field spells the same concept
   (cited, current) — as evidence, not as authority (rati's plain-English rule can
   overrule the field's jargon, and has).
5. **Rank top-3.**

## Boundaries

- No code; no renaming litigated already in naming.md without new evidence (the record is
  the bar to clear).
- Coherence *defects* (an export that contradicts the rules as they stand) belong to
  REV-01 — file a pointer, don't double-report.
- `src/data/` excluded; the vocabulary rules (plain English, no coined terms, `mandala`
  stays internal) bind every proposal.

## Verify

- The re-derivation diff committed under `docs/research/` with each divergence dispatched
  (scar-with-reason or proposal-with-severity) — no undispatched divergences.
- The breaking-now-cheap list explicitly marked as the headline in the effort README's
  summary note, with the top-3.
- Zero overlap with naming.md decisions absent new evidence (each engagement cites the
  section it argues with).
