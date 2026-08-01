---
area: packages/rati/src/data/keyed.ts
needs: a maintainer call — grow `delete`, or document the boundary
status: done
disposition: option 1 taken 2026-07-27 — delete(key): boolean under reset()'s contract; jnana:FND-236's second map can adopt on the next release
---

# FND-08 — `keyed` has no per-key delete, so a bounded-but-shrinking map can't use it

## Problem

`keyed(factory)` exposes `get` / `peek` / `reset`. `reset()` is all-or-nothing (the
documented sign-out case), so a caller that wants to drop **one** key has nowhere to go —
and that is what stops an otherwise-perfect `keyed` candidate from adopting it.

Found during jnana's DATA-14 adoption (`jnana:FND-236`), which swapped one hand-rolled
`Map<key, Query>` onto `keyed` successfully and had to keep a second.

## The receipt

`JobDetailStore` holds one `Query<AdminJobDetail>` per job id, with a `forget(id)` the
detail dialog calls on close. Job ids are unbounded, so without the per-key drop the map
grows for the lifetime of the admin session.

The reference's own guidance — "an *unbounded* key space wants a **selection**, not a map"
— points at `reactive: true` instead, but that is a different shape. A selection holds one
instance whose parameters change, which reintroduces exactly the race the per-id map was
built to remove: a slow fetch leaves the previous job's detail on screen under the new
job's heading. The map is the right shape here; only the eviction is missing.

## What is *not* being asked

Recorded so it isn't re-derived. jnana's `ResourcePool` was evaluated for the same swap and
deliberately kept hand-rolled. It shares only the get-or-create shape; everything it exists
for is outside `keyed`'s stated scope — reference counting, a grace-TTL / count-cap /
byte-budget eviction cascade, Proxy-wrapped access, teardown coupled to a doc's replica
bytes — and its factory takes a second argument beside the key (`load(id, data)`), which
`keyed(factory: (key) => I)` cannot express. That is not a gap in `keyed`, and a `delete`
would not change the verdict. This finding is only about the one missing verb.

## Options (rati's call)

1. **`delete(key): boolean`** — the `Map` method the type already implies, under the same
   "dropping the reference *is* the semantics" contract `reset()` documents, one key at a
   time. Keeps the "a map, not a cache" framing intact: deleting on request is not a cache
   policy, it is the caller knowing the key is spent.
2. **Nothing, and say so** — document that a key space needing eviction is out of `keyed`'s
   scope, so the next migration doesn't re-litigate it. `JobDetailStore`'s hand-rolled map
   is then correct as written.

Either answer closes this; the cost of leaving it open is that every consumer re-derives
the same analysis.

## Verify

- If option 1: `delete` drops the instance, a subsequent `get` builds a fresh one, and the
  return distinguishes present from absent. If the instance holds anything disposable, the
  same teardown `reset()` performs runs for the single key.
- If option 2: the boundary is stated in the `keyed` reference section, next to the existing
  unbounded-key-space guidance.
