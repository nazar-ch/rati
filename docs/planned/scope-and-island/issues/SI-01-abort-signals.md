# SI-01 — abort signals for data loads

area: packages/rati/src/mandala/resolver.tsx, src/scope/scope.ts (load types), docs
needs: —
disposition: cut 2026-07-19 from scope-and-island-directions.md §1

## Problem

A param change or teardown discards a level's in-flight promise loads, but the underlying
`fetch` keeps running to completion — wasted work, and a consumer with expensive queries has
no cancellation hook. `rati/data`'s `query` already threads an `AbortSignal` through its
producer; the core scope path has no analogue (verified at cut: no `AbortController` outside
`src/data/`).

## Scope

1. **One `AbortController` per resolver bucket.** The resolver already owns the remount
   boundary (`mandala/resolver.tsx` — buckets go stale on inner-tree remount / unmount /
   refresh). Create the controller when the bucket's cells are built; abort it wherever the
   bucket is discarded: param-change remount, `refresh()` re-resolve, retry, unmount.
   Audit every discard path — the stale-bucket detach logic marks them.
2. **The load signature gains a second argument.** Promise loads become
   `(props, { signal }) => Promise<T>` — an options bag, not a bare signal, so future
   additions don't reshuffle parameters. Loads that ignore it behave exactly as today
   (backwards compatible). `hook()` loads and sources are excluded — sources' `detach()` is
   already their cancellation.
3. **Type-level care:** the added parameter must not degrade inference on the props argument
   or the return type (the end-to-end inference is the framework's point). Add a type test
   (`*.test-d.ts`) alongside the runtime tests.
4. **SSR:** under `prepareRoute`/collect there is no remount — the controller exists but
   never fires during a normal render; a request abort story is out of scope (note it in the
   record if the seam turns out to be cheap).
5. **Docs:** guide (the load-levels section gets the signature + a fetch example) and
   reference (the load function contract). The research doc's §1 example is the template.

## Boundaries

- No retry semantics, no timeout option — cancellation only.
- No changes under `src/data/` (its signal already exists and is differently scoped).
- Don't abort on plain re-renders — only on real bucket discards; a signal that fires while
  the bucket is still current is a bug.

## Verify

- `yarn ci` green.
- Pins: the signal fires exactly once per discarded bucket (param change, unmount, refresh
  each pinned); a load ignoring the second argument resolves as before; an aborted load's
  late rejection is swallowed (no unhandled rejection, no state write to the stale bucket).
- The type test pins that props inference is unchanged with and without the second argument.
