---
area: docs/current/RELEASING.md, .claude/kit.json
needs:
status: open
disposition: —
---

# FND-10 — RELEASING.md cites CHANGELOG.md parent-relative, and no gate here would catch the next one

Spotted in passing by jnana-kit's findings-close-2 batch (jnana-kit PR #110), measured from a kit
pool slot: `check-doc-links.ts` pointed at this checkout reported
`docs/current/RELEASING.md:3 ../../CHANGELOG.md ✗ parent-relative`. Filed 2026-07-30 as the consumer
follow-up that report named.

## Problem

`docs/current/RELEASING.md:3` links the changelog as `[CHANGELOG.md](../../CHANGELOG.md)`. The
family doc-link convention (jnana-kit:///plugin/docs/planning.md §"Doc links") bans `../` chains:
they re-encode their depth on every move and are ungreppable from the target side. The root-relative
form (`CHANGELOG.md` from the repo root — here written as the root-relative path) survives the
citing file's own move and keeps `rg CHANGELOG.md` able to find every inbound reference.

Second, structural half: rati's `verify` is `yarn ci fmt lint typecheck test` — **no doc-links
gate** — so nothing in this repo would flag the next violation either. The kit's checker
(`jnana-kit:///tools/check-doc-links.ts`) is what caught this one, from another repo's session, by
accident of kit◊FND-63's measurement.

## Scope

1. Fix the link: `docs/current/RELEASING.md:3` cites the changelog root-relatively.
2. Decide whether to wire the kit's doc-links check into `verify` (a `verify:*`-style step in the
   `ci` chain, the way jnana runs it) — the sweep that decision implies is small here (few docs, one
   known violation), and without it this class stays invisible.

## Verify

- `sh "$JNANA_KIT_HOME/tools/run-node.sh" "$JNANA_KIT_HOME/tools/check-doc-links.ts"` from this
  repo's root reports zero violations (and prints this checkout as the measured root).
- If step 2 is taken: the repo gate goes red on a deliberately added `../` link, then green on its
  removal.
