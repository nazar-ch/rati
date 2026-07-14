# ssr-baseline-remains — server kit, consumer migrations, coverage tail

Status: planned 2026-07-14, cut at the close of the SSR-baseline round.

The 2026-07 SSR baseline shipped in rati core: head management (`Title`/`Meta`/
`useTitle`/`HeadProvider` + `headTags`), the versioned hydration payload
(`serializeHydration`/`readHydration` + integrity diagnostics), collector error
recording with status derivation, route-level redirects + `matchedCatchAll`, and the
composed `renderApp` — documented in [docs/public/ssr.md](../../public/ssr.md), with
per-item deltas stamped into
[ssr-nazar-patterns.md](../../research/directions-2026-07/ssr-nazar-patterns.md). This
effort finishes what that round deliberately left: the **server kit** (Layers 2/3 —
design record: [ssr-server-kit.md](../../research/directions-2026-07/ssr-server-kit.md),
maintainer-confirmed), the **consumer migrations** (nazar.ch, jnana website), and the
**coverage tail** the implementing session consciously left thin.

## Decisions taken 2026-07-14

- Kit shape per ssr-server-kit.md is settled at the layer level (Vite plugin owning
  dev + build + manifest/modulepreload; fetch handler + Node adapter for prod;
  everything under `rati/*` entries, no package slicing). Its anti-bloat lines are
  binding; in-item design freedom is below that line only.
- Consumer migrations wait for the kit (migrate once, not twice); if the kit stalls, a
  checkpoint may re-decide and migrate consumers straight onto the baseline.
- Tracking is manual, jnana-shaped: status derives from rati git — `SSR-NN:` commit
  subjects, a `Closes: SSR-NN` trailer on the finishing commit. No status written into
  these files.

## Items

SSR-01…03 build the kit in dependency order (dev plugin → build/assets →
prod handler + example adoption). SSR-04/05 migrate the two real consumers onto it —
three hosts (plain Node, Vercel function, Hono), one plumbing implementation, which is
the kit's validation. SSR-06 is the independent coverage tail and can run first or in
parallel with anything.

Batching, dependencies, grading: [plan.md](./plan.md).

## Per-item conventions

rati works in atomic commits on the current branch (its `CLAUDE.md`); prefix subjects
with the item id (`SSR-01: …`), put `Closes: SSR-01` in the finishing commit's trailer
block, keep `vp run rati#typecheck` + `vp lint` + `vp run rati#test` green, and keep
`docs/public/ssr.md` + `docs/internals.md` in sync with behavior changes. Findings out
of an item's scope get a dated note appended here, not a silent fix.
