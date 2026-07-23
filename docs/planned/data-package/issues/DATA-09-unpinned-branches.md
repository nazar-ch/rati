---
area: packages/rati/src/__tests__/data — tests only, no source changes expected
needs: nothing
status: done
disposition: cut 2026-07-20 from a coverage map of the data tests taken at the DATA-03 review
---

# DATA-09 — pin the unpinned data branches

## Problem

The data suite is strong on the primary contracts (phases, race guard, debounce,
reactive tracking, source(), reconciliation, form/submit), but a source-vs-test sweep
found real branches with no pin:

- `query.ts`: a **synchronous throw inside the reactive `Reaction.track()`** must be
  re-raised outside it (the `caught` plumbing in `callProducer`) — no test throws
  synchronously from a `reactive: true` producer.
- `query.ts`: `source().subscribe()`'s unsubscribe is only checked to have fired
  once, not that it **stops firing** after unsubscribe.
- `itemMap.ts`: `insert()` on an existing key (delegates to `upsert`, keeps
  position); `upsert()`'s equals-short-circuit on a genuinely unchanged raw; a custom
  `equals`; `clear()` — never reached, since no test resets a flat collection's query
  (`onReset → map.clear()` wiring unexercised).
- `itemMap.ts`: `upsert`/`insert`/`remove` racing an in-flight `reconcile()` from
  `refresh()` — the README's recorded last-write-wins stance has no test stating it.

## Scope

One test commit pinning each branch above where the behavior is intended; if a branch
turns out unreachable or wrong, that's a finding for the README, not a silent fix.

## Verify

- `vp run rati#test` green with the new cases; no source diffs (or a README note if a
  branch disagreed with intent).
