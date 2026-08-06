---
area: packages/rati/src/data — new reconciled.ts, collection.ts rebuilt over it (+ itemMap.ts, reference.md, internals.md)
needs: DATA-12 (same leg — the facade forwards `prime`)
status: done
disposition: cut 2026-07-25 from the second-round migration feedback (breaking; collection stays a primitive — no fold into query)
---

# DATA-13 — `reconciled()` derived view; `collection` becomes a full facade

## Problem

Two second-wave findings, one structural cause:

1. **Composite responses hit a wall.** `collection` assumes the response *is* the array. A payload
   like `{ usefulData: string; spaces: SpaceRow[] }` is a `query` — and then its list half gets no
   identity-stable reconciliation at all. The intended pattern (a MobX-shaped store class per key
   stitching composite data into a convenient observable surface) has no rati part to build the list
   half from.
2. **The half-facade.** `Collection` forwards `refresh()` but not the ensure, and exposes `.query`
   for phase/error — "you're perpetually asking: is this on the collection or the query?"

Maintainer direction: **no fold** of collection into query (clean extension instead — collection
keeps its name and its paged-loader lineage). The structural move is splitting the reconciler out of
the fetch: `collection` is secretly `query` + `itemMap`; expose the second half as a standalone
derived view.

## Scope

1. New `reconciled(rows: () => readonly T[], options: ItemMapOptions<T, Item>)` — an identity-stable
   view over *any* observable rows (typically a slice of a query's `data`). A MobX-tracked
   derivation re-runs `itemMap.reconcile` when the getter's output changes; exposes `items`,
   `getByKey`, `patchItem`, `upsert`, `insert`, `remove`. No fetch, no phase, no source — the
   backing query owns those. Worked example (the composite case):

   ```ts
   overview = query((signal) => fetchOverview(this.spaceId, signal));
   spaces = reconciled(() => this.overview.data?.spaces ?? [], { key: (s) => s.id });
   get usefulData() { return this.overview.data?.usefulData; }
   ```

   Design care: when the derivation runs (computed-with-reaction vs observed-only), teardown, and
   interplay with `patchItem`'s next-reconcile-restores-truth marking — same contract as inside
   collection today.
2. `collection({ fetch, key, … })` rebuilt as the sugar case: `createQuery` + `reconciled`
   pre-wired. Public shape becomes the **full facade** and `.query` leaves it: `items`, `phase`,
   `error`, `isPending`, `prime()`, `refresh()`, `reset()`, the keyed ops, `source()`. Raw
   pre-reconcile `data` is not exposed — `items` *is* the value surface.
3. `pagedCollection` untouched except mechanical fallout (it builds on `createQuery`/`itemMap`
   directly).
4. Docs: reference.md — `reconciled` documented as the composite-response answer, collection's
   section rewritten to the flat surface; internals.md §data updated (query + itemMap + reconciled
   layering).
5. Tests: reconciled over a changing getter (identity kept across swaps, patch marking honored,
   teardown), the facade (ensure/refresh/phase reach the backing query), and the composite worked
   example end to end.

## Boundaries

- No cross-key/normalized entity cache — per-key instance identity is `keyed`'s (DATA-14),
  within-key row identity is the reconciler's; the same entity reached via two keys staying two
  objects is accepted and documented (DATA-17's page says so).
- `itemMap` internals stay internal; `reconciled` is the public face.
- No change to `query` beyond what DATA-12 already did.

## Verify

- `yarn ci fmt lint typecheck test` green.
- The composite example compiles and behaves: one fetch, `usefulData` read directly, `spaces.items`
  identity-stable across `overview.refresh()`.
- `rg '\.query\b' packages/rati/src examples` finds no public reach-through.
