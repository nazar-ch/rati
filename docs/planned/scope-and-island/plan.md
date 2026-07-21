# scope-and-island — implementation plan

Items live in [issues/](issues/); status derives from rati git (`git log --grep 'SI-'`,
`Closes:` trailers). No status here.

## Batches

### B1 — independent pair (execution)

- **Items:** SI-01 (abort signals), SI-04 (`ssr: false`). Disjoint concerns; SI-01 lives in
  the resolver's bucket lifecycle, SI-04 in the collect-time path — they share
  `mandala/resolver.tsx`, so if run as parallel sessions, land SI-01 first (its
  `AbortController`-per-bucket touches the same cell-building code SI-04 branches around);
  serial in one session is simpler and fine.
- **Entry:** none.
- **Exit / checkpoint:** both landed with pins; `yarn ci` green. No semantics review needed —
  both shapes are pinned by the research doc.

### B2 — the engine change (execution; calibration gate)

- **Items:** SI-03 (`keepStale` + `phase`/`isStale`/`retry` on `useScopeControls`).
- **Entry:** B1 merged (SI-03 edits the same resolver files).
- **Exit / checkpoint:** the kept-bucket mechanism and the extended controls surface land
  with pins; **the maintainer reviews the semantics** — what `phase` reports in each state,
  when `isStale` flips, what an error during a stale re-resolve shows — before B3/B4 build
  on them. This is the effort's calibration gate: every later item reads this surface.

### B3 — the delay (execution)

- **Items:** SI-02 (`loadingDelayMs`).
- **Entry:** B2 merged and its semantics review done.
- **Exit / checkpoint:** the delay lands riding the kept-bucket mechanism; the composed
  contract (delay + `keepStale` → loading slot only on a slow first load) pinned; docs
  updated with the interplay note.

### B4 — error handling tail (execution; serial lane)

- **Items:** SI-05 (retry policy), then SI-06 (SSR error dehydration). Serial: both touch
  `mandala/boundary.tsx`, and SI-06's hydrate-to-error path must not race SI-05's automatic
  retry (a dehydrated error must respect the same policy switch).
- **Entry:** B2 merged (SI-05 reports through the phase surface). SI-06 additionally reads
  the hydration wire format — no dependency on SI-02.
- **Exit:** both landed with pins, including the interaction pin (a dehydrated error with a
  retry policy configured); `yarn ci` green at the deep fuzz budget (the mandala fuzz suite
  must not regress under the kept-bucket + retry changes). Effort ready to close.

## Grading

| Item | Model / effort | Why |
| --- | --- | --- |
| SI-01 | Opus, medium | one controller per bucket at an existing boundary; the care is the type change on the load signature |
| SI-04 | Opus, medium | mechanically small, but the no-mismatch hydration contract must be pinned exactly |
| SI-03 | Opus, high | the engine change: kept committed props across a `treeKey` remount + the public status surface — judgment-dense, sets the bar |
| SI-02 | Opus, medium | a timer over the mechanism SI-03 built; the composition pins are the work |
| SI-05 | Opus, medium | the counter exists; the discipline is `failed`-only, timer teardown, phase visibility |
| SI-06 | Opus, high | a wire-format addition + a resolver-level catch path + a hydrate-to-error cell — three subsystems meet |

The Agent tool sets `model` but not reasoning-effort — carry the effort tier as a
thoroughness line in the prompt.

## Orchestration notes

- Suits the **Agent tool** / plain sessions (small heterogeneous batches, one real
  checkpoint), not Workflow.
- All items commit to rati `main` directly. The examples are consumers: the ssr gallery
  should gain a page (or extend one) per shipped option where it foregrounds server/client
  behavior (`ssr: false`, `ssrErrors`) — each item's record says which.
- The mandala fuzz suite (`src/__tests__/fuzz/`) is a standing tripwire for B2–B4: the
  kept-bucket change alters remount observable behavior only when `keepStale` is set, and
  the harness never sets it — an item that makes the fuzz suite move has changed default
  behavior and must stop and say so.
