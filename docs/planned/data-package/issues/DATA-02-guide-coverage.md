---
area: docs/public/guide.md (+ website nav if the guide grows a page)
needs: — (independent)
status: done
disposition: cut 2026-07-18 at the implementation session
---

# DATA-02 — guide coverage for the data layer

## Problem

`docs/public/reference.md` now carries the `rati/data` API section, but the guide — the
mental-model document the website leads with — teaches scopes, islands and routes over
promise loads and stops there. The data layer's model (instance-owned primitives, the
first-load-through-the-island / live-updates-through-MobX division, forms as staged
drafts, two-sided optimism) is exactly the kind of thing the guide exists for, and it
currently lives only in a research doc contributors read.

## Scope

1. A guide section (or page — follow the guide's existing granularity) walking the
   store-graph example end to end: a collection in a store, its `source()` in a route
   scope, a component observing `items`/`phase`, a mutation with an optimistic patch,
   a dialog form seeded from an item. The reference stays the API station; the guide
   teaches *when to reach for which primitive* and the island/instance division of
   labor.
2. Mark the experimental status the same way reference.md does.
3. If the website's nav is generated from the docs, check the new content renders
   (docs/website-plan.md owns that surface).

## Boundaries

- No new API surface; if writing the guide exposes an awkward seam, that is a finding
  for the README, not an in-item fix.
- Keep SSR expectations honest: the primitives stay pending under SSR (attach runs in
  effects) — the guide must not suggest otherwise.

## Verify

- Docs-only; `vp check` green (Markdown is hand-formatted — oxfmt excludes it).
