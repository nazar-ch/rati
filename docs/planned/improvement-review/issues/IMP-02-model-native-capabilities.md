---
area: docs/research/ (output); scope/, mandala/, island/, router/ as reading
needs: — (best after scope-and-island lands)
status: done
disposition: cut 2026-07-19; improvement-review direction 2
---

# IMP-02 — what the scope model uniquely enables

## Problem

A scope is a *declarative, typed, inspectable* description of a page's data: which props,
which levels, which dependencies — as a plain value, before anything runs. Hook-based peers
can't have this by construction; rati has it and exploits almost none of it. The July
review touched the edges (navTrace ships; dataTrace is cut in testing-and-dx;
dependency-graphs.md records the `derive()` idea) — but nobody has taken "the spec is data"
as a premise and asked what it buys end to end. That is this session's single question.

## Scope

Directions the cut expects the session to weigh (a starting map, not a fence — the net-new
ones are the point):

1. **Static analysis & tooling.** The scope graph is known at module load: waterfall depth
   linting ("this prop could live a level earlier"), dead-input detection, a printable
   dependency graph per route, bundle-time route → data manifests (what SSG/prefetch could
   consume — engage ssg-and-rsc.md's recorded direction rather than restating it).
2. **Prefetch inference.** A `Link`'s target route names its scope; its scope names its
   loads. What does hover/viewport prefetch look like when the framework can *see* the
   first level's loads statically? (Router-extensions territory borders this — cite it.)
3. **Introspection at runtime.** A devtools panel's data model is nearly free (scopes,
   levels, phases, timings already exist in the resolver); what minimal public
   introspection surface would let a devtools extension exist *without* freezing
   internals? (dataTrace is the console sibling; this is the structured one.)
4. **Composition patterns.** Scope reuse across routes/islands beyond `.extend()`'s
   recorded sketch — parameterized scope factories, scope-level test fixtures
   (testing-and-dx borders), server-side scope execution outside React (the resolver as a
   plain async function — what would consume it?).
5. **The all-or-nothing dial.** Resolution atomicity is the model's signature; are there
   principled *partial* shapes (level-granular commits) that keep coherence — or is the
   right proposal a written defense of why not? Either is a valid output.

For each direction kept: the README's proposal format (problem, sketch, precedent — here
often "no peer can do this", which is the interesting kind — cost, trigger). Rank top-3.

## Boundaries

- No code; proposals must respect the naming rules (plain English, no coined terms) and
  the "internal engine stays internal" line — a proposal that requires publicizing
  `mandala` internals must instead design the minimal public seam.
- `src/data/` excluded; undecided/dependency-graphs.md and deferred-scope-features.md are
  engaged (extended/argued-with), not duplicated.
- Feasibility sketches may reference resolver internals as evidence, but no proposal may
  *depend* on implementation details staying fixed.

## Verify

- Proposals filed under `docs/research/` (new file or extensions), each citing the
  records it borders (dependency-graphs, deferred-scope-features, router-extensions,
  ssg-and-rsc, dx-and-tooling) — the anti-duplication check.
- Each proposal names its trigger (what real need graduates it) — the wait-for-need
  discipline applied.
- Summary note in the effort README with the top-3.
