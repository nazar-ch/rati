---
area: docs/research/ (output); the public surface + examples as the walked path; a scratch consumer app as the instrument
needs: — (best after scope-and-island lands)
status: open
disposition: cut 2026-07-19; improvement-review direction 3
---

# IMP-03 — adoption & interop friction

## Problem

rati grew inside Jnana, where it owns the whole app. A public adopter's reality is the
opposite: an *existing* React app with its own router, state, and build, into which rati
must arrive incrementally — or a fresh app whose author gives the framework one hour to
prove itself. Neither path has ever been walked. The gaps that block them are invisible
from inside Jnana by construction, and they are adoption-killers: the best resolution model
loses to "I couldn't mount one island in my existing app".

## Scope

Walk the paths for real — a scratch app per leg, driving the actual package (built, not
`rati-dev`), noting every friction point with its severity:

1. **The one-island foothold.** An existing CRA/Vite app with React Router already in
   charge: can a single `island()` mount in one corner — no rati router, no `StoresProvider`,
   no vite plugin? What is the *minimum* ceremony, what breaks, what merely embarrasses?
   This is the incremental-adoption story's first step; if it doesn't exist, the proposal
   is what would make it exist.
2. **Coexistence.** rati islands under a foreign router (URL params must come from
   somewhere — what is the seam when RouterStore isn't the source?); a foreign data layer
   (redux/react-query) feeding scope inputs; rati's `Link` vs the host's; two islands
   sharing one store without the full stores container.
3. **The greenfield hour.** Fresh Vite app → first route rendering data, timed and
   journaled: every error hit, every "where does this import from" pause, every step the
   examples paper over because they were written by the author. (Docs quality is out of
   scope; *API-shaped* friction — a missing default, a mandatory option that could be
   inferred, an unhelpful error — is exactly in scope.)
4. **Interop outward.** A rati island's subtree using ordinary context/portals/suspense
   from the host app; nesting islands; an island inside a modal mounted outside the tree.
   What breaks, what's undefined, what should be stated?
5. **Proposals** from the walk: each friction point → fix-proposal (README format) or a
   recorded "cost of the model, accepted" position. Rank top-3.

## Boundaries

- No code changes to rati; the scratch apps are session artifacts (committed under the
  findings note as reproduction material or linked gists — not into the repo tree).
- Writing the missing guides is the docs effort's job; this session *names* which guides
  are missing as findings, and only API-shaped fixes become proposals.
- `src/data/` excluded; framework-hosting (Next/RSC) interop is REV-07's importability
  smoke + postponed rsc-support.md — engage, don't duplicate.

## Verify

- The walk journals (per leg: steps, timings, friction list with severity) attached to the
  effort README's summary note — the evidence the paths were walked, not imagined.
- Proposals filed under `docs/research/`, each traceable to a journal entry (no armchair
  proposals).
- Summary note with the top-3.
