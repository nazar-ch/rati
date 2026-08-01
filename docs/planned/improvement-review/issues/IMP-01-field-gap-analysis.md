---
area: docs/research/ (output); the whole public surface as reading
needs: — (best after scope-and-island lands)
status: done
disposition: cut 2026-07-19; improvement-review direction 1
---

# IMP-01 — gap analysis against the field

## Problem

rati's adopters arrive from somewhere — react-query/SWR + React Router, TanStack
Router/Query, Next/Remix loaders — with expectations trained by those tools. Some gaps are
deliberate (rati's model *replaces* hook-style loading; the design intent in `CLAUDE.md` is
the filter, not a defect list), some are known-and-recorded (router-extensions.md is
largely this list for the router), and some nobody has noticed because no adopter has hit
them yet. The last set is this session's quarry: find the gaps before the first public
adopter does, and turn each into a recorded position — build it, plan it, or document "why
not" — rather than a surprise.

## Scope

1. **Build the comparison honestly.** For each neighbor (react-query/SWR, TanStack
   Router+Query, React Router data APIs, Next/Remix): enumerate the features its users
   *lean on daily*, checked against current docs at session time (versions noted, claims
   cited). Candidate axes the cut expects — mutation/invalidation stories, optimistic
   updates, prefetching (hover/viewport), infinite/paginated loading at the route level,
   devtools presence, code-splitting ergonomics, scroll/focus/pending UX affordances,
   request dedup/caching across islands, offline/PWA posture — but the session's job is
   the axes it didn't expect.
2. **Filter through rati's stance.** For every gap, classify: (a) covered differently by
   the model (write the mapping down — it is documentation fuel even though writing docs
   is out of scope here); (b) deliberately rejected (cite the record); (c) recorded and
   waiting (cite it — no re-proposal); (d) **net-new gap** → a proposal. The data layer's
   territory (query caching, mutations) is excluded from *proposing* but named where a gap
   lands there, so the data effort inherits the note.
3. **Proposals** for class (d), in the README's format: problem, sketch shaped to rati's
   vocabulary, field precedent, cost, trigger. Special attention to gaps that are cheap
   *because* of rati's model (e.g. anything the declarative scope makes analyzable that
   hook-based peers must do dynamically).
4. **Rank:** the top-3 note.

## Boundaries

- No code; no docs/current edits; `src/data/` gaps filed as notes to the data effort, not
  proposed here.
- Not a marketing comparison — an internal engineering gap list; unflattering findings are
  the valuable ones.
- Neighbors' *bugs* and pricing/ecosystem politics are out; API capabilities only.

## Verify

- The comparison table + classification committed under `docs/research/` (new file, linked
  from research README) with every field claim cited (URL + version, checked this
  session).
- Class-(c) entries each cite the existing record — zero duplicated proposals (the
  anti-duplication rule's check).
- Summary note in the effort README with the top-3.
