---
area: design — rati/data's transport stance (and/or jnana's API layer)
needs: the maintainer's call; blocked on it
status: open
disposition: cut 2026-07-20 from the DATA-03 findings (gap 3)
---

# DATA-08 — the fetch-boilerplate helper decision

## Problem

DATA-03's line-count verdict (+4 overall) traces to one repetition: every producer in
the migrated jnana code re-states `if (!res.ok) throw new Error(\`HTTP ${status}\`)`
plus a branded-response cast — ~14 sites — the boilerplate `FetchStore` used to own
once. The design record listed "a typed HTTP fetch helper (ok-check + `json()` +
error mapping)" among what rati needs to fully replace `FetchStore`; the migration
correctly didn't invent one mid-flight (DATA-03's own boundary). It is the one
migration finding that is a taste call rather than a clear fix.

## The tension

`rati/data` is deliberately transport-neutral — a producer is any
`(signal) => Promise<T>`; nothing in the package knows HTTP. A helper would buy back
the repeated lines and could map status → `SourceError.code` (`not-available` vs
`failed`) end to end, but it drags fetch/Response types into a package whose
primitives don't otherwise care, and the branded-cast half of jnana's boilerplate is
Hono-specific and can't move into rati anyway.

Options on the table:

1. **rati/data ships a small `okJson(res)`-shaped helper** (ok-check, `json()`,
   status → `SourceError` mapping). Consumers still add their own cast.
2. **Consumer-side helper** (jnana writes its own three-liner over its Hono client;
   rati documents the pattern in the guide's data section).
3. **Nothing** — accept the repetition as honest per-producer code.

## Verify

- The decision recorded here and in the effort README (with the design record's
  helper line answered either way); if option 1, the helper + tests + reference.md;
  if option 2, a guide note and a jnana-side follow-up.
