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

- **Items:** SSR-07, SSR-08, SSR-09, SSR-10, SSR-11 — independent, any order (SSR-11
  decided 2026-07-15: inline output becomes the behavior; streaming went to research).
  SSR-12 (design-first) is filed but not batched; it enters a later batch once its
  design pass runs.
- **Entry:** the findings review (this cut).
- **Exit:** the five fixes landed with the gate green; SSR-12 dispositioned by the
  maintainer.

### B5 — the tail (execution; cut 2026-07-16)

- **Items:** SSR-12 (implementation — the design pass ran and the maintainer confirmed
  both open points, see the item's disposition), SSR-13. Independent, any order.
- **Entry:** none — both gates are cleared.
- **Exit:** the whole-document fallback lands with its canary pin and the
  throw→fallback walk; dev answers the app's status on a malformed escape, with the pin
  red-before green-after. Effort ready to close (the Vercel preview verification stays
  maintainer-blocked and is not an item).

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
| SSR-11 | Sonnet, low | decided: one prerender option + a pin + a docs paragraph |
| SSR-12 | Opus, high | design-first: the render-into-document constraint needs a spike (ran 2026-07-16; implementation follows the confirmed shape) |
| SSR-13 | Sonnet, medium | a contained dev-pipeline fix, but the sanitization shape needs care across both assembly paths |
