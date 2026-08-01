# production-review — multi-lens review before public/production usage

Status: planned 2026-07-19. Per-item status is each record's own `status:` field — a lens
flips its record to `done` in the commit landing its findings and fixes.

Seven independent review lenses over the rati package, each run as its **own session** (the
maintainer launches them individually — deliberately not an orchestrated pass). Every lens
reads its whole surface at full depth: these are prepare-for-strangers reviews, not diff
reviews, and "very deep" is the cut's explicit mandate — read everything in the lens's
scope, execute rather than assume, and prefer a day finding one real defect over an hour
filing ten plausible ones.

Out of scope for every lens: `src/data/` (experimental, not ready — its review comes with
its extraction decision), `docs/` prose quality and the website (separate efforts). The
examples are in scope as evidence (they are how several lenses drive the real thing) and
`examples/ssr` ships as the public gallery, but example *polish* is not the subject.

## Decisions taken 2026-07-19 (at cut)

- **Fix-or-file:** a lens session **fixes** confirmed, decision-free, small defects
  in-session, each with its pin (the router-review precedent: the open-redirect guard was
  closed in-round). Anything needing a semantics decision, a sizable change, or crossing
  another lens's ground is **filed** as a dated finding here — never silently fixed, never
  silently dropped. The close-out batch (below) turns accumulated findings into follow-up
  items.
- **Findings discipline is the router-fuzz reviews' discipline:** every claim confirmed by
  hand against the real engine before it is filed (drive it, don't read it); a finding
  records the repro; "already covered" claims are executed, not assumed.
- **Depth over coverage counts:** no finding quotas. A lens that honestly finds nothing
  states what it drove to conclude that — a clean bill with evidence is a valid result.
- **Cut assuming the stores-container work has landed.** Every lens re-derives its file
  inventory from `HEAD` at session start rather than trusting this cut's snapshot.

## Items

Any order, any parallelism — the lenses are read-heavy and independent; overlapping
territory is fenced in each record's Boundaries. REV-03 carries the one already-known
defect (the `is.class` minification bug behind the gallery's blank `/counter`) as its
entry example. REV-04 and REV-07 share StrictMode ground — the fence: REV-04 owns
teardown/leaks/lifecycle correctness, REV-07 owns React-version and rendering-mode
semantics.

- [REV-01 — public API surface & types](issues/REV-01-api-surface-and-types.md)
- [REV-02 — failure modes & messages](issues/REV-02-failure-modes-and-messages.md)
- [REV-03 — packaging & production build](issues/REV-03-packaging-and-production-build.md)
- [REV-04 — lifecycle, teardown & leaks](issues/REV-04-lifecycle-and-leaks.md)
- [REV-05 — security](issues/REV-05-security.md)
- [REV-06 — performance](issues/REV-06-performance.md)
- [REV-07 — React compatibility & rendering modes](issues/REV-07-react-compatibility.md)

## Plan

- **Entry:** after the scope-and-island and testing-and-dx efforts land (reviewing a surface
  about to change is wasted depth). A lens that starts earlier must note which pending items
  overlap its ground and skip them.
- **Batches:** each lens is its own session/batch; no orchestration. Suggested first:
  REV-03 (it holds a known bug and gates whether production builds can be trusted while the
  other lenses drive them).
- **Exit / close-out:** all seven filed their findings; a closing session (its own small
  planning batch) reads the accumulated findings, cuts follow-up items for everything
  file-sized, and moves this effort to the archive with the findings as its record.
- **Grading:** every lens is judgment-dense review work — strongest available model, high
  effort, sessions sized to the lens (a lens may take multiple sittings; findings append as
  they're confirmed).

## Findings

(Dated notes appended by lens sessions as claims are confirmed. Format: what was driven, the
repro, fixed-in-session vs filed, severity for filed items.)

## Per-item conventions

Atomic commits on the current branch; in-session fixes and their pins prefixed `REV-NN:`,
the record's `status: open` → `done` in the lens's finishing commit (which may be the
findings-note commit if nothing was fixed). `yarn ci` green after any fix. Fixes keep docs in sync
(standing rule); findings do not pre-edit docs for changes not yet made.
