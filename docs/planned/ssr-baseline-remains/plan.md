# ssr-baseline-remains — implementation plan

Items live in [issues/](./issues/); status derives from rati git
(`git log --grep 'SSR-'`, `Closes:` trailers). No status here.

## Batches

### B1 — coverage tail (execution; independent)

- **Items:** SSR-06.
- **Entry:** none — runs any time, in parallel with everything.
- **Exit:** the listed deterministic gaps covered; suite green.

### B2 — the server kit (execution; sequential)

- **Items:** SSR-01 → SSR-02 → SSR-03 (each builds on the previous; one agent may take
  the chain).
- **Entry:** none (design is settled in
  [ssr-server-kit.md](../../research/directions-2026-07/ssr-server-kit.md)).
- **Exit / checkpoint:** `examples/ssr/server.ts` deleted — dev runs on `vite dev`,
  prod on `rati/server`'s `serve()`; the example's behaviors re-verified (statuses
  200/404/301, head tags, payload, hydration console-clean). **User reviews the plugin's
  option surface before B3** — the migrations will freeze it.

### B3 — consumer migrations (execution; parallel after B2)

- **Items:** SSR-04 (nazar.ch), SSR-05 (jnana website). Different repos; fully
  parallel.
- **Entry:** B2 merged + its option-surface review. If B2 stalls, a checkpoint may
  re-decide and migrate straight onto the baseline surface instead (both records note
  the baseline-only variant).
- **Exit:** both consumers on the released rati surface, hand-rolled SSR plumbing
  deleted, smoke-verified in their own deployment shape. Effort ready to close.

### B4 — findings round (execution; after B3, cut 2026-07-15)

- **Items:** SSR-07, SSR-08, SSR-09, SSR-10 — independent, any order. SSR-11 (blocked
  on a maintainer discussion) and SSR-12 (design-first) are filed but not batched;
  they enter a later batch once unblocked.
- **Entry:** the findings review (this cut).
- **Exit:** the four fixes landed with the gate green; SSR-11/12 dispositioned
  (scheduled or closed) by the maintainer.

## Grading

| Item | Model / effort | Why |
| --- | --- | --- |
| SSR-01 | Opus, high | plugin/dev-server integration; the option surface is API design |
| SSR-02 | Opus, high | environments-API build orchestration + the lazy-chunk mapping unknown |
| SSR-03 | Sonnet, medium | composition of settled pieces onto fetch semantics |
| SSR-04 | Sonnet, medium | mechanical migration + rename sweep; real-deploy verification |
| SSR-05 | Sonnet, medium | same, Hono-shaped |
| SSR-06 | Sonnet, medium | deterministic tests against a settled surface |
| SSR-07 | Opus, high | the hydration-phase design touches store semantics; the settle heuristic is judgment |
| SSR-08 | Sonnet, medium | a small ordering fix + a pin flip + two doc paragraphs |
| SSR-09 | Sonnet, low | one peerDependenciesMeta line |
| SSR-10 | Sonnet, low | docs only |
| SSR-11 | — | not batched: maintainer discussion first (the record carries the mechanics) |
| SSR-12 | Opus, high | design-first: the render-into-document constraint needs a spike |
