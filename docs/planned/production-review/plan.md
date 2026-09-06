# production-review — multi-lens review before public/production usage

Seven independent review lenses over the rati package, each run as its own session — the maintainer launches them individually, deliberately not as an orchestrated pass. Every lens reads its whole surface at full depth: these are prepare-for-strangers reviews rather than diff reviews, and "very deep" is the cut's explicit mandate — read everything in the lens's scope, execute rather than assume, and prefer a day finding one real defect over an hour filing ten plausible ones.

Out of scope for every lens: `packages/rati/src/data/`, which is experimental and not ready, so its review comes with its extraction decision; and docs prose quality and the website, which are separate efforts. The examples are in scope as evidence — they are how several lenses drive the real thing, and `examples/ssr` ships as the public gallery — but example *polish* is not the subject.

## Sequence

The lenses run in any order and at any parallelism: they are read-heavy and independent, and overlapping territory is fenced in each record's Boundaries. REV-03 is the suggested first, because it holds the one already-known defect — the `is.class` minification bug behind the gallery's blank `/counter` — and it gates whether production builds can be trusted while the other lenses drive them. REV-04 and REV-07 share StrictMode ground, and the fence is that REV-04 owns teardown, leaks and lifecycle correctness while REV-07 owns React-version and rendering-mode semantics.

Entry: after the scope-and-island and testing-and-dx efforts land, since reviewing a surface about to change is wasted depth. A lens that starts earlier notes which pending items overlap its ground and skips them.

Close-out, once all seven have filed: a closing session — its own small planning batch — reads the accumulated findings, cuts follow-up items for everything file-sized, and moves this effort to the archive with the findings as its record.

## Orchestration notes

- **Fix-or-file.** A lens session *fixes* a confirmed, decision-free, small defect in-session, each with its pin — the router-review precedent, where the open-redirect guard was closed in-round. Anything needing a semantics decision, a sizable change, or crossing another lens's ground is *filed* as a dated finding in that lens's own record: never silently fixed, never silently dropped. The close-out batch turns accumulated findings into follow-up items.
- **Findings discipline is the router-fuzz reviews' discipline.** Every claim is confirmed by hand against the real engine before it is filed — drive it, don't read it — a finding records the repro, and an "already covered" claim is executed rather than assumed. For a type finding the repro is the code plus the error text observed.
- **Depth over coverage counts, and there are no finding quotas.** A lens that honestly finds nothing states what it drove to conclude that: a clean bill with evidence is a valid result.
- **Every lens re-derives its file inventory from `HEAD` at session start** rather than trusting the cut's snapshot.
- `yarn ci` green after any fix, and a fix keeps the docs in sync — the standing rule. A finding does not pre-edit docs for a change not yet made.
- **Grading**: every lens is judgment-dense review work — strongest available model, high effort, sessions sized to the lens. A lens can take several sittings, with findings appended as they are confirmed.
