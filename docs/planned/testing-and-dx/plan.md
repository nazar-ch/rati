# testing-and-dx — implementation plan

Items live in [issues/](issues/); each record's `status:` field is the workflow state.
No status here.

## Batches

### B1 — entry foundation (execution; calibration gate)

- **Items:** DX-01.
- **Entry:** none.
- **Exit / checkpoint:** the `rati/testing` entry exists with `deferred`/`flush`/
  `controllableSource`, documented; **the maintainer reviews the API style** (names, options
  shapes, what `controllableSource` exposes, docs placement) — every later item copies this
  style.

### B2 — the three harnesses (execution; parallel lanes, one fence)

- **Items:** DX-02 (island harness), DX-03 (router + stores harness), DX-04 (SSR kit).
  Mutually independent in substance; the fence is the shared entry barrel
  (`src/testing/index.ts`) and the shared reference.md section — if run as parallel
  sessions, each lane adds its exports additively and rebases; serial in any order is
  simpler.
- **Entry:** B1 merged and its style review done.
- **Exit / checkpoint:** all three harnesses public and documented; each proved against at
  least two real existing suites converted in-item (the full sweep is B3's).

### B3 — dogfood (execution; aggregation)

- **Items:** DX-05.
- **Entry:** B2 merged.
- **Exit / checkpoint:** rati's suites use the entry; the duplicate helpers are deleted;
  suite counts and coverage unchanged (a migration that loses a pin is a defect); `yarn ci`
  green including deep fuzz.

### B4 — the success test (execution; cross-repo)

- **Items:** DX-06.
- **Entry:** B3 merged (the utilities are proven at home first).
- **Exit:** the Jnana migrations land (their repo, their conventions); before/after deltas
  and friction findings recorded in this effort's README. Effort ready to close after the
  findings are read.

### B-side — observability (independent)

- **Items:** DX-07. Any time, no dependencies.

### B-side — SSR error channel (independent)

- **Items:** DX-08 (cut 2026-07-19 from the pre-DX-05 review). Any time; before or during
  B3 is natural — DX-05's `islandSsrErrors` conversion is easier to trust once `errors`
  can't silently drop a reused rejection (fresh-promise-per-render suites are unaffected,
  so it is not a blocker).

## Grading

| Item | Model / effort | Why |
| --- | --- | --- |
| DX-01 | Opus, high | public API style calibration — small code, but every name here is permanent |
| DX-02 | Opus, medium | promotion of an existing core; the judgment is the public option surface |
| DX-03 | Opus, medium | same, plus the stores-seam design against the post-container surface |
| DX-04 | Opus, medium | the drain/hydrate mechanics exist in tests; packaging them without freezing internals is the care |
| DX-05 | Sonnet, medium | mechanical sweep with a hard no-lost-pins rule |
| DX-06 | Opus, medium | cross-repo judgment: migrate honestly, file friction instead of forcing fits |
| DX-07 | Sonnet, low | two small additions with existing patterns to copy |
| DX-08 | Opus, medium | a semantics-sensitive engine dedup change (per-collector keying must not break the within-render pin) plus one kit option |

The Agent tool sets `model` but not reasoning-effort — carry the effort tier as a
thoroughness line in the prompt.

## Orchestration notes

- Suits the Agent tool / plain sessions. DX-06 runs in `~/Sites/jnana` (rati consumed via
  `rati-dev`, so unreleased utilities are visible there immediately).
- Design constraint for every harness item: the testing entry may depend on `react` and
  `react-dom/client` (peers already) but must not *require* `@testing-library/react` — where
  a harness benefits from it, take it as an optional integration decided in DX-01's style
  review, not a hard dependency the entry drags in.
- The fuzz harnesses keep working throughout: promotion means the fuzz files import the
  public core (or a thin internal wrapper), not that the fuzz surface changes. Fuzz suites
  moving is a tripwire, same rule as ever.
