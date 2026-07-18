# DATA-01 — `reactive` params for query (design pass first)

area: packages/rati/src/data/query.ts (+ collection/pagedCollection options)
needs: a design decision against the mandala's selective refresh (below)
disposition: cut 2026-07-18 at the implementation session, deferred by maintainer choice

## Problem

The design record (§1) specifies `options.reactive: true`: track the producer's
observable reads (a MobX reaction over its synchronous prefix) and re-run on change as
a debounced `refresh()`. It is the type-ahead case `remoteData` was built for and the
fix for `JobsListStore`'s manual `load()`-after-every-setter — six stores re-fetching
by hand today. Implicit refetching must never be the default in a package whose ethos
is explicitness.

## The design pass (do this before any code)

The mandala already owns a selective-refresh machine (`mandala/refresh.ts`,
`useScopeControls().refresh(key)` — internals.md §Selective refresh): a changed scope
value re-runs exactly the downstream promise loads whose producers read the key. A
reactive query answers the same question — "my inputs changed, re-fetch" — one layer
down, inside the store. Cross-check before committing to a shape (maintainer
instruction):

- Where is the line? A route-param-driven fetch belongs to the scope (param change →
  new resolution); a keystroke-driven filter belongs to the store (reactive query).
  Write the rule down in the design record so the two mechanisms don't compete for the
  same cases.
- Scheduling: reaction-per-query (simple, isolated) vs a shared scheduler (batched
  cross-query bursts). The design record leaves it open; reaction-per-query is the
  presumptive answer unless the cross-check surfaces a real batching need.
- Interaction with `debounce`: a reactive re-run *is* a refresh — it should flow
  through the existing scheduled/coalesced path, not add a second timer.
- The tracked window: the producer's synchronous prefix only (reads after the first
  `await` are untracked — MobX's standard boundary). Document it loudly; it is the
  sharp edge of the feature.

## Scope

1. The design note (a dated section in data-package.md or here) answering the four
   points above.
2. `reactive: true` on `query` per that note, walking the tracked-read → debounced
   `refresh()` path; phase reads `refreshing` (data present) as any refresh does.
3. Collection/pagedCollection pass-through (a reactive paged collection resets to the
   first page on tracked-param change — cursors are invalid; pin that contract).
4. Tests: tracked-read re-run, untracked post-await reads don't re-run, debounce
   coalescing of a burst, reset-on-filter-change for the paged case.

## Boundaries

- Opt-in only; no implicit tracking by default, ever.
- No public scheduler surface — whatever scheduling lands is internal.

## Verify

- New tests red with the reaction wiring reverted; `yarn ci` green.
