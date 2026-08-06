---
area: packages/rati/src/mandala/boundary.tsx, packages/rati/src/mandala/retryPolicy.ts
needs:
status: open
disposition: —
---

# FND-09 — under React StrictMode a retryable island failure still hangs on `loading`

FND-07 fixed the terminal hang: on 0.7.0 a `retryable: true` load failure spends its budget with a
real jittered backoff and falls through to the error slot. **With `<StrictMode>` around the tree it
does not** — it sits on the `loading` slot indefinitely, which is the FND-07 symptom exactly.

StrictMode is dev-only, so this costs no production user anything. It costs every *development*
session on every consumer that runs StrictMode (jnana does, by default), and it is the mode a
consumer debugs a 5xx in.

## Measured (jnana's dev build, real Safari / STP 27, rati 0.7.0, 2026-07-29)

`adminUsersScope` — a plain promise `.load` island on a route — with `window.fetch` stubbed to force
one status for `GET /api/admin/users`, attempts timestamped, the rendered slot sampled every 500 ms.
The only thing changed between the two tables is jnana's `strictMode` const in `main.tsx`.

**Baseline first, because the original jnana-side measurement was normalised wrong:** a *successful*
resolution fires **2** fetches with StrictMode on and **1** with it off. Raw fetch counts under
StrictMode therefore carry the double-fire and are not a count of retry attempts.

StrictMode **on** — forced 500 (`retryable: true`), two runs:

| Run | Fetches | Gaps (ms) | Slot outcome               |
| --- | ------- | --------- | -------------------------- |
| 1   | 3       | 5, 1      | `loading`, still at 30.0 s |
| 2   | 3       | 9, 2      | `loading`, still at 30.4 s |

StrictMode **off** — same forced 500, two runs:

| Run | Fetches | Gaps (ms)       | Slot outcome          |
| --- | ------- | --------------- | --------------------- |
| 1   | 5       | 2, 1, 232, 512  | error slot, at 1.51 s |
| 2   | 5       | 2, 0, 291, 1058 | error slot, at 2.02 s |

232/512 and 291/1058 are two independent draws from `[0,500]` then `[0,1000]` — the documented
schedule, working. Non-retryable statuses (403/404/422) reach the error slot in **both** modes, so
only the retrying branch is affected.

The manual path is fine in both modes: from the error slot with a forced 500 and StrictMode on,
`retry()` gave 3 attempts at gaps of 600 and 1058 ms and ended on the error slot — a fresh budget
with real backoff, as the reference promises. **It is the mount path, and only under a
double-invoked render.**

## Where to look

FND-07 moved the budget spend out of `accept()` (render) and into `arm()` (commit) so that "a
discarded concurrent render spends nothing". StrictMode is precisely a double-invoked render with
one discarded pass, so the interaction is in that seam rather than somewhere unrelated:

- `accept()` memoises its ruling per generation via `ruledOn` and returns the *cached* `accepted`
  for a repeat generation. Under a double render, is the second pass reading a ruling made by a pass
  whose commit never happened — `accepted` true, `armedFor !== ruledOn`, and no commit arriving to
  call `arm()`?
- `arm()` no-ops unless `accepted && armedFor !== ruledOn`. If the discarded pass armed and the kept
  pass shares its generation, the kept pass's commit finds `armedFor === ruledOn`, starts no timer —
  no retry, and the boundary is left rendering `loading` with nothing pending.

Both are guesses from the shipped bundle's shape, not from a repro — the value here is the
measurement and the seam it points at.

## Verify

- A `retryPolicy` / boundary test that renders the island **inside `<StrictMode>`** and asserts the
  error slot is reached on a `retryable: true` failure. The existing FND-07 test passes without
  StrictMode, which is why this shipped: the double-invoked path is untested.
- Neuter the fix and confirm the new test goes red, so it pins this and not the substrate.
- Then jnana re-runs its table with StrictMode on and every row ends on the error slot
  (`jnana:///docs/backlog/rati/issues/FND-237-island-retry-hangs-on-loading.md`).
