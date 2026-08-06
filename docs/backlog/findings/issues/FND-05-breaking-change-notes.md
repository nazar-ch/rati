---
area: docs/current/ — a changelog/migration home; RELEASING.md gains the step
needs: nothing
status: done
disposition: closed 2026-07-27 — root CHANGELOG.md seeded with the 0.6.3 entry as the format exemplar + the RELEASING.md pre-bump step; no consumer needed the 0.6.3 backfill by then (all four migrated), so the value is forward-looking
---

# FND-05 — no changelog or migration note carries a consumer across a breaking release

## Problem

rati ships no CHANGELOG, and the public docs describe only the current surface —
`rg 'RootStore|RouterStore' docs/current/public/` returns nothing after 0.6.3. A consumer upgrading
across a caret range has no artifact naming what broke or what it maps to. The only record of
0.6.3's removals is the commit message on `eb70b87` and a resolution banner on a research doc,
neither of which a consumer reads.

0.6.3 is the case in point: it removed seven public exports (`RootStore`, `RootStoreProvider`,
`GlobalStore`, `GlobalStores`, `GenericStoresContext`, `createUseStoresHook`, `useGenericStores`),
took `RouterStore` internal, dropped `rati/testing`'s `storesWrapper` / `renderWithStores` /
`PartialStores`, renamed `RouterStoreOptions` → `RouterOptions`, and changed `createTestRouter`'s
options — all under a version range (`^0.6.2`) that resolves into it automatically.

Three consumer repos migrated on 2026-07-27 (jnana, nazar.ch, alla). Each independently
reconstructed the same mapping from rati's source and commit history. That is the cost this record
is about: the mapping exists, it is just not written down anywhere a consumer looks.

## Why it matters

rati is pre-1.0 and breaking changes are expected — that is the argument *for* the note, not against
it. The versioning already promises the break (a minor bump pre-1.0); what is missing is the half
that tells someone what to do about it.

**The `Router` rename deserves its own line** wherever this lands, because it fails unhelpfully. In
0.6.2 `Router` was the outlet *component*; in 0.6.3 it is the router *interface type*, and the
outlet is `RouterOutlet`. So a pre-existing `import { Router } from 'rati'` + `<Router />` keeps
resolving and fails as "a type imported as a value" rather than the clean "has no exported member"
every other removal gives — the error points at the usage, not at the removal, and a reader can
spend a while deciding the import is fine.

## Scope

1. Pick the home and format — a root `CHANGELOG.md`, or a `docs/current/public/` migration page the
   website renders (the public docs are "the main station for anything user-facing", so a rendered
   page has the stronger claim). Maintainer's call.
2. Backfill 0.6.3 from `eb70b87`'s message and the release diff: removed / added / renamed, each
   removal paired with its replacement, plus the `Router` rename note above. Earlier versions are
   not worth reconstructing — start here and keep it going forward.
3. `docs/current/RELEASING.md` gains the step, so the note is written with the release rather than
   after a consumer asks.

## Boundaries

- Documentation only; no API changes ride along.
- Not a full history backfill — 0.6.3 forward.

## Verify

- A reader who knows only "my build broke on `RootStore`" can find the replacement from the docs
  alone, without reading the source or `git log`.

## Correction (2026-07-29) — step 3's remedy did not hold on its first outing

The disposition above calls the value "forward-looking". The first release forward, **0.7.0
(2026-07-29), shipped with no entry** — two days after this closed. The step landed as prose in
`RELEASING.md` and nothing else: no gate, and nothing written until release time, which is the
moment with the least attention on it. jnana adopted 0.7.0 by reading `git log v0.6.3..v0.7.0`,
which is exactly the cost this record was filed about.

Fixed by moving *when* the note is written rather than adding a gate: entries go in a standing
`## Unreleased` section in the same commit as the behavior (the rule now sits in `CLAUDE.md`, next
to the docs-in-sync one), and a release retitles that section. 0.7.0 is backfilled. This record
stays `done` — its scope was the artifact, and the artifact exists; what failed was the discipline
around it, and that is now stated where the change is made instead of where it ships.
