# data-package — the rati/data remains

The 2026-07-18 session shipped the design record's v1 in rati (docs/archive/directions-2026-07/data-package.md): the legacy `data/` layer and its Babel decorator toolchain removed, and the `rati/data` entry landed with all five primitives — `query`, `collection`, `pagedCollection`, `mutation`, `form`/`field` plus the validator kit — over the shared `itemMap` reconciler. `source()` bridges through `instanceSource`, the suite sits under `packages/rati/src/__tests__/data/`, and docs/current/public/reference.md gained a `rati/data` section beside the internals one.

This effort carries what that session deliberately left: the API gaps the consumer migrations exposed, the second round the wave-two migrations cut, and the extraction decision that closes it.

## Sequence

### Round one — the gaps the first migration exposed (cut 2026-07-18, extended 2026-07-20)

DATA-01 through DATA-09. DATA-01 runs first — the design pass against the mandala's selective refresh, then `reactive` on the three read primitives — because DATA-03's reactive-read leg consumes it. DATA-03's migration then cuts DATA-05 through DATA-09 from what it hit.

DATA-05 and DATA-06 are coupled through jnana◊FND-106: restoring the optimistic retention hop needs the write seam and the on-error recovery refresh of a keyed query together, and jnana unskips its HI-03 store test after the rati release that carries the pair.

### Round two — the wave-two feedback (cut 2026-07-25)

Four independent legs, then two on what they land:

- **A** — DATA-10 then DATA-11: the two-level `SourceError` first, retry gated by error class on top of it.
- **B** — DATA-12 then DATA-13 on one branch, in that order: the `prime()` rename, then `reconciled()` and the collection facade.
- **C** — DATA-14.
- **E** — FND-03 (docs/archive/backlog-closed-1/issues/FND-03-is-class-minification.md), which runs in this batch because the class-factory pattern DATA-13 and DATA-14 bless must not be broken under minification.
- Then, on the landed surfaces: **D** — DATA-15 and DATA-16; **F** — DATA-17 and DATA-18.

DATA-19 is parked rather than sequenced: its record is the parking spot for the form success-state discussion, and a third independent hand-roll is the bar that cuts it into an assignable item.

### DATA-04 last

The extraction and entry-layout decision runs after DATA-08's answer and the round-two API items, so it extracts the surface the migrations demanded rather than the one they outgrew.

## Orchestration notes

- docs/current/public/reference.md and docs/current/internals.md stay in sync with the shipped surface, in the item's own commits: this repo declares no spec, so those two are what the standard footer's "update the touched spec" names here.
- An open question the design record recorded is answered by whichever item touches its area first, and DATA-04 is the backstop for the rest.
