# Selective scope refresh & SSR-capable sources — implementation notes

**Status: implemented** (`useScopeControls` + `data()` + `Source.ssr`, with test coverage in
`__tests__/mandala/scopeControls.test.tsx` and `__tests__/mandala/islandSsrSources.test.tsx`).
The canonical docs (`design-and-usage.md`, `internals.md`) and the examples are deliberately
**not** updated yet — that, the `data()` rename, and the public-surface review are the next
checkpoint. This note records the settled design and maps it onto the code.

## 1. Selective refresh — `useScopeControls`

```ts
const { refresh, pending } = useScopeControls(pageScope);
await refresh('members');   // one load re-runs; content never blanks
refresh();                  // whole scope re-resolves (the retry bump)
```

Design decisions, as settled in discussion:

- **Verbs, not handles.** The hook never exposes the underlying promises/sources — components
  keep receiving strictly resolved state. A second scope-keyed channel (the *controls channel*,
  `controls.ts`, mirroring the value channel's WeakMap registry) carries a per-mandala-instance
  `RefreshController`; nearest island wins, no import cycles.
- **Re-runs happen in render, not imperatively.** `refresh(key)` marks the cell dirty and
  triggers a bare re-render; the Step re-runs the producer where `prev` naturally lives — with
  current upstream values, including values a cascade swapped in the same pass (levels render
  top-down).
- **Stale-while-refetch, no Suspense re-entry.** The old value stays rendered while the re-fetch
  is in flight; on a changed settle the cell becomes a *value cell*, so the new value renders
  synchronously — `use()` never sees a fresh promise, the loading slot never flashes.
- **Deep equality gates the cascade** (`deepEqual`, the comparator the mandala already trusts for
  inputs), with a reference fast path. A re-fetch of identical JSON keeps the old value *and
  identity*; nothing downstream moves. Per-load override: `data(fn, { equals })` — the `data()`
  marker (pairs with `hook()`: `hook` says how a load runs, `data` says what it is and carries
  options; **name pending the rename round**). The etag/version comparer is the intended use for
  large payloads.
- **Dependents come from recorded reads.** Producers run against a `Proxy` over the resolved bag
  (`trackReads`); the per-cell read-set is what a change fans out along. Destructuring — the
  dominant idiom — reads eagerly at call time, so the set is deterministic and complete; lazy
  `(bag) => bag.x` styles re-record per run. Dependents can only live in later levels (a level
  never sees siblings), so the fan-out walks levels below only.
- **Cascades cover all three cell kinds.** A dependent promise load re-runs with the same
  stale-while-refetch treatment; a sync value load re-runs in the same render pass; a dependent
  *source* is re-created — old entry detached, new attached (the level's `sources` array is
  replaced, re-keying the Step's effects and uSES subscription), with the pre-swap value bridging
  the new source's pending window. A `.provide()` value whose factory consumed a changed key
  disposes and rebuilds (factory reads are tracked the same way).
- **Scope boundaries**: promise loads only. Sources refresh themselves (the data-package division
  of labor), hook loads re-run every render anyway, static entries have no producer — all warn
  and no-op. `refresh()` with no key is the existing retry mechanism (loading slot shows; it
  composes with the future `keepStale`, improvements.md §2).
- **Failure keeps the previous value.** The returned promise *resolves* (fire-and-forget callers
  don't trip unhandled rejections); the failure is logged. Richer error surfacing on the controls
  is future work.
- **`pending: ReadonlySet<key>`** — keys currently re-fetching (refreshes + their cascade), an
  external store on the controller (notifications microtask-deferred, so render-time bookkeeping
  never setStates during render).

### Implementation map

- `mandala/refresh.ts` — the cell model (`Cell` = value/promise/source + refresh bookkeeping:
  read-set, `rerunnable`, `equals`, `dirty`, `refreshing` token, `lastValue` baseline),
  `trackReads`, `sweepDetach`, and `RefreshController` (locate/validate, settle gating, dependent
  marking, waiters, the pending store, the changed-key event the provide-leaf subscribes to).
- `mandala/resolver.tsx` — the render halves: `buildCell` (hydration short-circuit, seed
  application, server promotion of SSR sources), `processDirtyCells` (re-run + gate + swap),
  stale rendering in the resolve loop, and the source-lifetime rework (below).
- `mandala/controls.ts` — the controls channel + `useScopeControls` (+ `ScopeControls` type;
  `ScopeLoadKeys<S>` in scope.ts types the key argument).
- `mandala/mandala.tsx` — controller creation/wiring per instance, `treeCommitted` (settles
  bookkeeping on remount), the controls provider, and the unmount sweep.
- `scope/scope.ts` — `data()` / `DataLoad` / `DataLoadOptions` (symbol-branded like `hook()`).

**Source-lifetime rework** (the one structural change): Step detach used to release everything on
cleanup. With swaps, a cleanup can't tell a deps-change from an unmount — so the Step keeps
entries its *live* bucket still holds (releasing swap leavers and stale-bucket runs), and the
mandala's unmount effect sweeps whatever is still attached. Ordering invariants hold: the
`.provide()` dispose is a layout cleanup and every layout cleanup flushes before any passive
cleanup, so dispose-before-detach survives; StrictMode's remount still detaches through the sweep
before the fresh run rebuilds.

## 2. SSR-capable sources — the `ssr` marker

The blocker was mechanical: `prerender` waits on Suspense only, and sources neither suspend nor
attach (effects don't run server-side). The marker authorizes exactly what's missing — *attach
during render, settle in reasonable time* — and the resolver derives the promise itself
(`firstSettle`, `mandala/ssrSource.ts`: attach + subscribe until non-pending + detach). The trust
is the same one extended to any promise load; render budgets belong to the prerender helper
(ssr-nazar-patterns.md), not here.

One rule, two shapes (`SourceSSR<T>` in `scope/source.ts`):

- **`ssr: true` — a loader in source clothing.** Promise semantics end to end: the ready value
  (JSON-safe) dehydrates into the ordinary `data` section; on the client the key short-circuits
  to that value and the producer never runs — no instance, no attach, no double fetch. Marking a
  genuinely *live* source `true` would trade its liveness away on hydrated mounts; live sources
  belong to the second shape.
- **`ssr: { hydrate, dehydrate? }` — a live source that can be seeded.** The server dehydrates
  `dehydrate(value)` (default: the value) into the new `seeds` wire section; the client creates
  the source as usual, calls `hydrate(data)` *before* attach, and the first snapshot is already
  ready — no pending gap, no double fetch, fully live afterward. This is the shape for
  instance-yielding sources (a query's `source()`): only data travels, the store graph rebuilds
  the instance.
- **Unmarked sources are untouched**: pending HTML, client resolution — previous behavior, and
  the right call for anything that can't seed.

Wiring: the hydration registry (`mandala/hydration.tsx`) gains `seeds` next to `data`; the
collector's `collect(mandalaId, key, value, kind?)` defaults `kind` to `'value'` so pre-existing
collector signatures stay assignable. Server-side promotion is **gated on the collector being
present** — resolving without dehydration would hand the client ready HTML it must re-render into
a pending source, a guaranteed hydration mismatch. `promiseSource(promise, { ssr })` and
`observableSource(getState, attach, { ssr })` take the marker as an option; `promiseSource` is
deliberately *not* auto-marked (its value may be non-serializable — flag for the checkpoint).

## Caveats & checkpoint items

- `data()` is a placeholder name (must pair well with `hook()`); revisit alongside naming.md.
- `refresh()` (no key) returns immediately — whole-scope completion isn't tracked yet.
- `refresh(key)`'s promise settles when the *key* does; its cascade may still be in flight
  (visible via `pending`).
- Hydrated cells carry no read-set until first re-run (their producer never ran) — they respond
  to direct refresh but aren't cascade targets until then.
- Refresh failures only log; no error state on the controls yet.
- `useScopeControls` does not yet expose `phase`/`isStale` — that half arrives with `keepStale` /
  `loadingDelayMs` (improvements.md §2), and the error-slot `retry` could then fold in too.
- Canonical docs (`design-and-usage.md`, `internals.md`), the examples gallery, and a
  `rati/mobx`-level convenience for query-backed seeds are all deferred to the checkpoint.
