---
area: every live doc and spec citing a path under docs/archive
needs:
status: done
approved: the user, in session on 2026-10-09: every live cite into docs/archive converts to a ◊ id or a quoted path, since no gate reads the archive (kit◊FND-226) (2026-10-09)
---

# FND-13 — live cites into the archive become ◊ ids or quoted paths

## Product framing

The kit's gates stop reading `docs/archive/` (kit◊FND-226), so a live doc or spec naming an archived file by its path points at something no gate can confirm, and the kit's `doc-links` step reds it. rati carries 43 such cites, measured with the kit branch's own gate on 2026-10-09.

## Problems to solve

- No live rati file points into the archive by path: an archived record is cited by its `rati◊<ID>`, and any other archived file is quoted in backticks.
- Every converted `◊` cite resolves, through origin's `refs/ids`, which kit◊FND-226 backfilled.

## Scope

1. Convert each finding of `~/jnana-kit/bin/verify.ts doc-links` that points into the archive: a record path becomes its `rati◊<ID>`, any other path a backticked quote.
2. Reflow any line the quoting pushes past the 700-character limit.

## Boundaries

- No file under `docs/archive/` is edited.

## Verify

1. `~/jnana-kit/bin/verify.ts doc-links` from the rati root prints no line naming `points into`.
2. `verify.ts` from the rati root is green.
