# DATA-04 — extraction & entry-layout decision

area: packaging — packages/rati (exports, peers) vs a new workspace
needs: DATA-03's findings (in: README §DATA-03 findings, 2026-07-20) and the API items
       they cut — DATA-05..08 — so the extraction ships the surface the migration
       demanded, not the one it outgrew
disposition: cut 2026-07-18 at the implementation session, from the design record's
             open questions

## Problem

`rati/data` is an entry in the rati package for the experimental stage — a deliberate
interim (maintainer-chosen at implementation). The design record's ground rules still
call for a companion package ("a companion package, not core"), and three packaging
questions were parked with it:

- **Package location**: a workspace here (`packages/rati-data`, keeping the `rati-dev`
  source-consumption trick for Jnana) vs staying an entry for good. Staying an entry
  costs: mobx-shaped code rides the core package's versioning and peer surface; the
  "core stays uSES-only" line blurs in the package listing.
- **`rati/mobx` absorption**: once the package exists, does `observableSource` move
  into it (one fewer entry) or stay the neutral bridge others build on? Today
  `rati/data` imports it from `../mobx/` — extraction must pick a direction.
- **Entry layout**: one entry, or a `…/form` subpath so data-only consumers don't see
  forms. Bundle-size reality check first: everything tree-shakes (`sideEffects:
  false`), so the subpath is API hygiene, not bytes.

## Scope

1. The decision, taken with the maintainer after DATA-03's verdict, recorded here and
   in the design record.
2. Its execution: either the workspace extraction (package.json, build, `rati-dev`
   wiring, Jnana's dependency) or the entry's promotion from "experimental" in
   reference.md — plus the `rati/mobx` direction either way.
3. CLAUDE.md / internals.md / reference.md updated to the outcome.

## Boundaries

- No API changes ride along; this is packaging only.
- Whatever the outcome, `SourceSymbol` identity across entries must survive (the
  rolldown shared-chunk note in vite.config.ts — a second package must import rati's
  runtime, not duplicate it).

## Verify

- `yarn ci` green; Jnana type-checks against the outcome via its normal consumption
  path (rati-dev or published, per the decision).
