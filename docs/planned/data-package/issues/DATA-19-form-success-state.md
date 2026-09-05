---
area: packages/rati/src/data — form.ts (if ever taken)
needs: real-world evidence from jnana's app-side latch
status: open
disposition: deferred 2026-07-25 — jnana latches success app-side; revisit with usage evidence
---

# DATA-19 — the success half of the form state machine (deferred)

## Problem

`isSubmitting` and `error` exist; "it worked" doesn't. Both second-wave form legs hand-rolled saved/done latches independently — for forms, "Saved." is the most common thing needed after a write. rati models the unhappy path richly (phases, `SourceError`, retry, stale-through-failure) and the happy path not at all.

## The discussion (2026-07-25)

The agreed direction, *if* this is ever taken, is two-level on both sides — successes with flavors, like failures with codes. Shapes considered:

- a `{ ok, error }` result object + `submit()` returning `Promise<boolean>` — rejected as lift-creep in miniature (the next request is a `.result?.ok` helper);
- a slim `submitStatus: 'idle' | 'submitting' | 'saved' | 'failed'`, clearing to `'idle'` on any field edit or new submit, failure detail staying on `form.error` — the candidate if evidence accumulates.

Decision: **nothing in rati for now.** jnana adds its own helper (part of the adoption record in jnana's tracker) and the topic is revisited once that helper's real shape and usage are known — the third independent hand-roll is the bar that cuts this into an assignable item.

## Boundaries (standing)

- Whatever lands must keep `submit()`'s action-compatibility (never rejects).

## Verify

- N/A until re-opened; this record is the parking spot so the discussion isn't re-derived.
