# DATA-05 — a single-value write seam for `query`

area: packages/rati/src/data — query.ts (+ reference.md)
needs: nothing; jnana ◊FND-106 waits on it (with DATA-06) and on the next release
disposition: cut 2026-07-20 from the DATA-03 findings (gap 1)

## Problem

`collection` has `patchItem`/`upsert` — one identity story for optimistic edits and
server pushes. `query` exposes only readonly `data`, so a mutation's `optimistic:`
callback has nothing to write through for a single-value read. This cost jnana a
shipped behavior in the DATA-03 migration: the members payload is a composite object
(so a `query`, not a `collection`), and `updateHistoryRetention` lost its optimistic
hop — the retention Select now settles only when the refresh lands, and the HI-03
store test is `describe.skip`-ed (jnana ◊FND-106).

## Scope

Two methods on `Query<T>`, the single-value mirror of the collection pair:

- `set(next: T)` — replace the value (the server-push seam, `upsert`'s sibling).
  Sets `data` and marks the query as having data; does not touch `error` (an
  optimistic write is no evidence the server recovered — same stance as `patchItem`).
- `patch(producer: (current: T) => T)` — optimistic edit (`patchItem`'s sibling);
  no-ops when no value has arrived yet (nothing to patch).

Semantics to pin in docs and tests:

- `data` is `observable.ref`, so **the reference swap is the notification** — `patch`
  must return the next value (no mutate-in-place variant: in-place edits on a plain
  payload would be invisible).
- No dirty-mark is needed: unlike `itemMap`, a query refresh overwrites `data`
  wholesale, so `onError: 'refresh'` recovery works by construction.
- Last-write-wins against an in-flight refresh — consistent with the recorded
  collection stance (README open questions).

## Boundaries

- No phase changes: `set`/`patch` don't start or cancel fetches and don't clear
  errors.
- `pagedCollection`'s pages inherit the methods (they are queries); no paged-specific
  behavior is added here.

## Verify

- Tests: patch swaps the ref and notifies an observer; patch before first data
  no-ops; set from idle makes `source()` ready; a later refresh overwrites the
  patched value (the recovery path); a patch during an in-flight refresh loses to the
  settle.
- reference.md's `rati/data` section documents the pair.
- Downstream (not this item): jnana restores the optimistic hop via `mutation`'s
  `optimistic:` and unskips HI-03 (◊FND-106) — needs DATA-06 for the keyed recovery
  refresh, and a rati release.
