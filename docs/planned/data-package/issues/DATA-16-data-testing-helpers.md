---
area: packages/rati/src/testing (+ reference.md §rati/testing)
needs: DATA-12 + DATA-13 (helpers mirror the final surfaces)
status: done
disposition: cut 2026-07-25 from the second-round migration feedback
---

# DATA-16 — data-layer test helpers: `controllableQuery` + a controllable producer

## Problem

`rati/testing` has `controllableSource` and nothing for `rati/data`; every new data suite in the
jnana migration hand-rolled fake responses and controllable producers — "would have paid for itself
four times over in one session."

## Scope

1. `controllableProducer<T>()` — returns `{ producer, resolve(value), reject(error), calls }`: a
   `(signal) => Promise<T>` whose settles the test drives, with call count/args and per-call signal
   exposure (aborts observable). The low-level piece; works with plain `query`/`collection`
   construction in tests.
2. `controllableQuery<T>()` — the data analogue of `controllableSource`: a real `query` pre-wired to
   a controllable producer, both returned. Sugar over (1); phases stepped by resolving/rejecting.
3. Mirror what real suites needed: driving a `refresh` failure onto stale data, stepping the
   debounced/reactive paths (fake timers note), asserting abort on supersede.
4. reference.md §rati/testing documents both, with one worked store test.
5. rati's own data tests adopt the helpers where they visibly shrink setup (light touch — don't
   rewrite DATA-09's pinned branches wholesale).

## Boundaries

- Helpers live in `src/testing/`; no production entry changes.
- No fetch/HTTP mocking (transport-neutral, like everything else — DATA-08).

## Verify

- `yarn ci fmt lint typecheck test` green.
- A store-level test written with only the new helpers (no hand-rolled producer) exists in the suite
  and reads clearly.

## Deviation from the Boundaries: a `rati/testing/data` subpath (2026-07-25)

The Boundaries said "helpers live in `src/testing/`; no production entry changes", and the helpers
do live there — but they got their **own entry**, `rati/testing/data` (`src/testing/data/`), rather
than riding the existing `rati/testing` barrel. Recorded because it is a packaging change the record
did not authorize.

Why: `controllableQuery` imports `query`, which imports `observableSource`, which imports **MobX**.
A static re-export from `src/testing/index.ts` would put a top-level `import … from 'mobx'` in the
built `dist/testing/index.js`, so every `rati/testing` consumer — including an app that is MobX-free
by choice — would have to install the optional peer just to import `deferred` or `renderIsland`.
That is the exact boundary `rati/data` and `rati/mobx` already exist to hold; the testing kit now
holds it the same way, one entry per optional-peer boundary. Alternatives considered and rejected: a
dynamic import (an async factory for a helper whose whole point is terse setup), and injecting the
`query` factory as an argument (pushes the coupling onto every caller).

Cost: three lines of wiring — a `./testing/data` block in `packages/rati/package.json` `exports`, a
`testing/data/index` entry in `packages/rati/vite.config.ts`, and a pointer in the `rati/testing`
barrel's header. No production primitive changed.

## What landed

- `packages/rati/src/testing/data/controllableProducer.ts` — `controllableProducer<T, Args>()`: the
  producer plus the call ledger (`calls`, `callCount`, `lastCall`, `pendingCall`, `resolve`/`reject`
  settling oldest-first, each call carrying its `args`, `signal`, `aborted`, `settled`). `Args`
  names whatever precedes the trailing signal, so a `pagedCollection`'s `fetchPage(cursor, signal)`
  is covered.
- `packages/rati/src/testing/data/controllableQuery.ts` — `controllableQuery<T>(options?)`: a real
  `query` with the controls defined *onto the instance* (descriptors, so the ledger getters stay
  live). Not a façade — `q.source()` resolves with `q` itself, which a delegating wrapper would have
  quietly broken.
- `packages/rati/src/__tests__/testing/controllableData.test.ts` — the ledger, an out-of-order
  settle, abort-on-supersede, `args` capture through `pagedCollection`, a `collection` fetch, the
  refresh-failure-onto-stale-data path, the debounced path under fake timers, the reactive path, and
  the Verify's store-level test.
- reference.md: a `rati/testing/data` row in the entry table and a §`rati/testing/data` subsection
  with both worked examples and the three named patterns (abort on supersede, out-of-order settles,
  the debounced path).
- Adoption (light): `__tests__/data/query.test.ts` and `__tests__/data/collection.test.ts` lost
  every `const gates = [deferred(), …]; let call = 0;` triple and the one `let signal` capture. The
  reactive tests that read an observable *inside* the producer keep their hand-rolled gates — the
  tracked read is the producer's business, and the helper has nothing to add there (documented as
  the one limit).

## The `reactive` limit, recorded

`controllableQuery<T>({ reactive: true })` tracks nothing: its producer reads no observables. That
is not a gap to fix — reactive re-fetching is a property of the *caller's* producer, so the helper
would have to take one, at which point it is `controllableProducer` again. Documented in
reference.md rather than papered over.
