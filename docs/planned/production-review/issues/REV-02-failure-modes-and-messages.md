# REV-02 — failure modes & messages

area: every `throw` / `console.warn` / `console.error` / silent-catch in
      packages/rati/src (excluding data/), dev-vs-prod behavior divergence
needs: — (best after scope-and-island + testing-and-dx land)
disposition: cut 2026-07-19; production-review lens 2

## Problem

For a framework, errors are API: the difference between a usable tool and a frustrating one
is what happens on the *wrong* path. rati has a good local tradition (the RF-01/RF-08
"framework-shaped error" precedent: name the API, name the input, name the fix) but no
whole-tree audit that every failure mode meets it — and at least one known class where dev
and prod *disagree* on an error (the malformed-escape URL: 404 in production, 500 in dev,
found during RF-01 and left in `vite/` unfixed).

## Scope

1. **Census.** Grep every `throw`, `console.*`, empty/swallowing `catch`, and rejected
   promise left unhandled across `src/` (minus `data/`). For each: who hits it (framework
   author bug vs consumer misuse vs runtime condition), what the message names, is it
   actionable (does it say *what to do*), is the tone/format consistent (prefix
   conventions, quoting of user values).
2. **Provoke the big ones by hand.** Wrong-typed scope wiring, an island without its
   provider, `useScope` outside an island, `useScopeControls` with no matching island
   (these two have shaped errors — verify they trigger as written), a route table typo, a
   load that throws synchronously, a hydration payload that is malformed/absent/from a
   different build, double-`dispose`, `serve` against a missing dist. The observed message
   is the evidence; paste the worst verbatim into findings.
3. **Dev/prod parity.** Inventory every place behavior forks on environment (dev-only
   warnings, the vite plugin vs `rati/server` paths). The known malformed-escape 500 in dev
   is this lens's to fix or file (it sits in `vite/ratiSsr.ts` handing raw URLs to
   `transformIndexHtml` — pre-existing, confirmed during RF-01). Any place prod is
   *quieter* than dev about real corruption is a finding.
4. **Failure-path hygiene.** Errors thrown during teardown/dispose (masking the original),
   errors inside loading/error slots themselves, collector behavior when a load throws
   synchronously vs rejects — walked, not assumed.
5. **Consistency artifact.** The lens leaves behind a short written convention (message
   shape, when to warn vs throw) as a findings-note appendix — the close-out decides if it
   graduates into internals.md.

## Boundaries

- `src/data/` excluded.
- Message *copy* edits that keep meaning are in-session-fixable; changing *when* something
  throws vs warns vs proceeds is semantics — file it.
- The CLAUDE.md rule stands: don't remove `console.*` — a finding may propose it, the
  session doesn't do it unilaterally.

## Verify

- The census table (site → class → verdict) attached to the findings note — it is the
  evidence depth happened.
- Every provoked case's observed output recorded; fixed messages pinned by tests (message
  content at the RF-01 altitude: the framework-shaped parts, not incidental phrasing).
- `yarn ci` green after fixes.
