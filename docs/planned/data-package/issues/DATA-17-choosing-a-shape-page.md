---
area: docs/current/public/guide.md (or a sibling page + website nav)
needs: DATA-13 + DATA-14 landed (the guidance names reconciled/keyed); wave 2
status: done
disposition: cut 2026-07-25 from the second-round migration feedback ("the doc gap I'd fix first")
---

# DATA-17 — the "choosing a shape" page

## Problem

The reference documents each primitive well and says almost nothing about choosing
between them. Every migration leg re-derived the same judgements: composite payload →
`query` (+ `reconciled` for its list half), not `collection`; unbounded keys → a
selection, not a `keyed` map; a per-page read → per-mount, not store-owned. That's
the doc gap both feedback rounds ranked first — and it's cheap, because the
judgements are already written down.

## Scope

1. A "choosing a shape" section (or page, if guide.md is getting long — follow the
   guide's existing structure) covering, as decision guidance with one-line examples:
   - `query` vs `collection`: composite payload → query; the list half of a
     composite → `reconciled` over a slice; a response that *is* the array →
     collection; pages → `pagedCollection`.
   - store-owned vs per-mount: shared/long-lived → store instance; a per-page read
     whose lifetime is the visit → per-mount; where `source()` fits either way.
   - `keyed` is a lazy instance map, not a cache: bounded key spaces (spaces you're
     in) yes; unbounded (search results by term) → a single reactive query/selection.
   - when it doesn't belong in a store at all (derived values, one-shot loads a
     scope level already covers).
   - identity: per-key = `keyed`'s contract, within-key rows = the reconciler,
     cross-key = explicitly out of scope (two keys → two objects; say it plainly).
2. Cross-link from the reference's `rati/data` intro and from each primitive to the
   page ("not sure which? →").
3. Source material: the DATA-03 findings (effort README) and the second-round
   feedback quoted in the README's 2026-07-25 section — transcribe the judgements,
   don't re-derive.

## Boundaries

- Guidance only — no API changes ride this item.
- Don't restate the per-primitive reference; link into it.

## Verify

- `vp check` green (markdown is hand-formatted — oxfmt excludes it).
- Each judgement from the feedback list appears exactly once, with its "why".
- Website renders it if the guide grew a page (docs/website-plan.md conventions).

## Closing notes (2026-07-25)

Landed as a section, not a page: `docs/current/public/guide.md` §"Choosing a shape",
inside the existing `rati/data` section (guide.md is one page of `##` sections and did
not need splitting). Five judgements, one each: response-is-the-array (`collection` vs
`query` + `reconciled` vs `pagedCollection`), store-owned vs per-mount (with `source()`
as the bridge that costs nothing either way), `keyed` bounded vs unbounded key spaces,
the two shapes that want no primitive (derived values; a one-shot read the island
already covers), and identity at three levels (per key / within a key / none across
keys).

Cross-links from `docs/current/public/reference.md`: the `rati/data` intro (after the
primitive table), the end of the `reconciled` explanation, and `keyed`'s "a map, not a
cache" paragraph.
