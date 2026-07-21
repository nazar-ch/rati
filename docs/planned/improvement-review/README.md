# improvement-review — multi-direction improvement proposals

Status: planned 2026-07-19. Per-item status derives from rati git (`git log --grep 'IMP-'`,
`Closes:` trailers — the finishing commit is the one landing the session's proposal docs).

Four generative review directions over rati, each run as its **own session** (maintainer-
launched, deliberately not orchestrated): where the framework should go next, what adopters
will miss, what its own model uniquely enables, and what fresh eyes would change. The
output is **proposals, not code**: new or extended records under `docs/research/`, plus a
summary note here. This is the counterpart of the production-review effort — that one makes
the existing surface sound; this one asks what surface is missing.

Out of scope for every direction: `src/data/` (not ready — its roadmap is the data-package
effort's), documentation/website work (separate efforts), and anything already decided
against (the research tree's rejected options stay rejected unless a session brings
genuinely new evidence, and then the output is a "reopen?" note, not a re-proposal).

## The standing anti-duplication rule

Every session **starts by reading the existing design space** and may only propose net-new
(or materially sharpened) directions. The inventory to read, verified at cut:

- `docs/research/README.md` and everything it indexes — especially
  `router-extensions.md` (composition, layout scope, guards, typed search params,
  navigation status/blocking — a large claimed space; note `src/router/group.tsx` exists,
  so check what has landed since), `ssg-and-rsc.md`, and the executed
  `scope-and-island-directions.md` / `dx-and-tooling.md` (their efforts:
  `docs/planned/scope-and-island/`, `docs/planned/testing-and-dx/`).
- `docs/research/undecided/` (`.live()`/`.extend()`, `derive()`, SSR streaming) and
  `docs/research/postponed/rsc-support.md` — weighed or deferred; a proposal touching them
  must engage with the recorded reasoning, not restate it.
- `docs/archive/directions-2026-07/` — the July review's shipped record, including
  `naming.md` (the vocabulary rules any proposal must respect: plain English, no coined
  terms) and `data-package.md` (the boundary with the excluded layer).

A proposal that duplicates a recorded direction is the session failing its first
instruction. Citing the record it *extends* is how a session proves it read them.

## Decisions taken 2026-07-19 (at cut)

- **Proposal format:** each proposal is a self-contained section (or new file) in
  `docs/research/` in that tree's house style — the problem, the sketch, precedents in the
  field, the cost/risk, and what concrete need would trigger it (the research tree's
  wait-for-need discipline applies to *new* proposals too: a session recommends, the
  maintainer decides what graduates to planned).
- **Grounded generativity:** claims about what the field does (competitor behavior, a
  library's API) are checked against current sources at session time, not recalled; a
  proposal's "X can't do this" or "users of Y expect this" lines are cited.
- **Sessions rank their own output** — each ends with a top-3 ("if the maintainer reads
  only three proposals, these") so four sessions' breadth stays digestible.
- **Cut assuming the stores-container work has landed.**

## Items

Independent; any order; best after the scope-and-island effort lands (so sessions don't
propose what is already landing). IMP-01 and IMP-03 both look outward — the fence: IMP-01
compares against *other frameworks' features*, IMP-03 walks *the adoption path* into a real
existing app. IMP-02 looks inward at the model's unexploited structure; IMP-04 is the
unconstrained redesign pass.

- [IMP-01 — gap analysis against the field](issues/IMP-01-field-gap-analysis.md)
- [IMP-02 — what the scope model uniquely enables](issues/IMP-02-model-native-capabilities.md)
- [IMP-03 — adoption & interop friction](issues/IMP-03-adoption-and-interop.md)
- [IMP-04 — fresh-eyes ergonomics](issues/IMP-04-fresh-eyes-ergonomics.md)

## Plan

- **Entry:** after scope-and-island lands (testing-and-dx is nice-to-have context, not a
  gate). Production-review can run before, after, or interleaved — different questions.
- **Batches:** one session per item, no orchestration.
- **Exit / close-out:** four summary notes here, each with its top-3; the proposals live in
  `docs/research/`; a closing session reconciles overlaps between the four outputs (two
  sessions converging on one idea is signal, and the reconciliation note says so), then
  archives this effort. Graduation of any proposal to a planned effort is the maintainer's
  separate call.
- **Grading:** strongest available model, high effort — breadth of association *and*
  judgment about what to leave unproposed are both the work.

## Findings

(One dated summary note per session: proposals filed with links, the top-3, and anything
the session found that belongs to another effort — a bug found mid-exploration files to
production-review's README, not here.)

### 2026-07-20 — IMP-01 (field gap analysis)

Output: [docs/research/field-gap-analysis.md](docs/research/field-gap-analysis.md) —
the full comparison (react-query v5 / SWR 2, TanStack Router 1.170 + Start RC,
React Router 8.2, Next 16.2; every claim cited at session time), every field feature
classified (a) covered / (b) rejected / (c) recorded / (d) net-new, three proposals, and
four notes filed to the data effort (environment revalidation triggers, offline posture,
`pagedCollection` page cap, mutation serialization evidence).

**Top-3:** D1 — intent-based *data* prefetch (`<Link prefetch>` today preloads only the
chunk; all four neighbors preload data, and the declarative scope makes the prefetchable
prefix statically computable); D2 — scroll restoration deferred to the island's commit
(the restore currently clamps against the loading slot; shares its mandala→router signal
with the recorded navigation-status direction); the §2 back/forward note (every neighbor
makes back navigation instant, rati re-resolves — not proposed, but the adopter question
the recorded directions should be weighed against together).

Session notes: the existing records held up well against the field — most expected axes
(mutations, invalidation, stale UX, guards, search params, streaming, RSC) were already
class (a) or (c); the genuinely unnoticed gaps clustered in *pre-navigation* behavior
(prefetch, scroll, back/forward), which no prior record covers. Where the field moved
since a record was written (throwable redirects from data code, Standard Schema search
validation, view transitions as a stable `Link` prop, TanStack's `'data-only'` SSR mode,
`pendingMinMs`), the evidence was noted on the record rather than re-proposed. No `src/`
or `docs/current/` changes; no bugs found to file to production-review.

### 2026-07-20 — IMP-02 (model-native capabilities)

Output: [docs/research/scope-model-capabilities.md](docs/research/scope-model-capabilities.md) —
the end-to-end walk of what "the spec is data" buys, grounded in the source (scope.ts,
resolver.tsx, mandala.tsx, channel.ts) rather than the docs. The record's spine: the model
holds **two graphs** no hook-based peer has — the *declared shape* (levels, keys, kinds:
free at module load via `flattenLevels` + the classifiers) and the *observed dependency
graph* (per-cell read-sets from `trackReads`, refreshed by every run) — and each proposal
is one of the two graphs cashed in. Four proposals (M1 shape read, M2 prefix executor,
M3 placement advisor, M4 test doubles), the direction-5 defense, and the scope-identity
composition note.

**Top-3:** M2 — run the plain-data prefix of a scope outside React (the field guesses
what is safe to prefetch, rati reads it off the declaration; explicitly the first
implementation slice of IMP-01's D1, sharing its handoff/carrier design rather than
competing); M4 — declaration-level test doubles (`substituteLoads` in `rati/testing`:
per-key, typed, impossible at a hook call site; shares its one hard design question —
substituting hook keys — with M2); the all-or-nothing defense — level-granular commits
stay out (type honesty, the phase model), because **nested islands already are
level-granular commits spelled as composition** (parent's resolved props feed the child
island's inputs, today, no new API) — a documentation move for the guide, not a feature.

Session notes: the two directions the cut expected to be large mostly *reduced* onto
IMP-01's record — prefetch inference became M2's sharpening of D1, and runtime
introspection became M1 (the minimal seam D3's panel needs, answering the cut's
"without freezing internals" constraint — the walk is half-public today: `prevScope` and
`InputSymbol` are exported, the classifiers are not). The honest limits that shaped
everything: what a function load *returns* and what it *reads* are runtime facts, so the
statically-known prefix is provisional (a load may hand back a `Source`) and the advisor
is a heuristic (read-sets under-report conditional reads). The composition direction
yielded a fact rather than a feature — scope identity keys the channels, so factories
work but mint identities, and `.extend()`'s recorded identity question is that fact
surfacing. No `src/` or `docs/current/` changes; no bugs found to file to
production-review; one convergence for the reconciliation session: IMP-01 (D1) and
IMP-02 (M2) arrived at the same machinery from opposite directions, which the effort
README calls signal.

## Per-item conventions

Atomic commits on the current branch; subjects prefixed `IMP-NN:`, `Closes: IMP-NN` on the
finishing commit. Sessions touch `docs/research/` and this README only — no `src/` changes,
no `docs/current/` changes (a proposal is not yet behavior). `bash`-run doc checks: none
beyond `vp check` being unaffected (markdown is excluded from oxfmt — edit by hand,
match the tree's style).
