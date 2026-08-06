---
area: packages/rati/src/mandala — retryPolicy.ts + the boundary that calls accept/arm
needs: nothing
status: done
disposition: fixed 2026-07-27 (boundary same-pass reset + commit-time budget spend); live re-verification in jnana tracked by jnana:FND-237
---

# FND-07 — a retryable island failure never reaches the error slot, and the backoff never waits

## Problem

An island whose resolution fails with `retryable: true` spends its attempts and then **stays on the
`loading` slot indefinitely**. The error slot never renders, so there is no message, no manual
Retry, and nothing the user can do but reload the page.

Retry is default-on since DATA-11, and the gate reads `retryable`. So the moment a consumer starts
classifying its errors — which DATA-10/DATA-11 exist to encourage — this reaches **every 5xx and
every dropped connection, on every island**.

## Measured (jnana, live app, dev build, rati 0.6.3, 2026-07-27)

Driven in Chrome against a plain promise `.load` island, with `window.fetch` stubbed to force one
status for a single endpoint, counting attempts and sampling the rendered slot every 3s. Attempt
counts normalised against a measured 1 fetch per resolution.

| Forced status | `retryable` | Attempts | Slot after the attempts                     |
| ------------- | ----------- | -------- | ------------------------------------------- |
| 500           | `true`      | 3        | `Loading…` — still, at 15s and again at 24s |
| 403           | `false`     | 1        | error slot, at once                         |
| 404           | `false`     | 1        | error slot, at once                         |
| 422           | `false`     | 1        | error slot, at once                         |

The `retryable: false` rows behave exactly as documented, which localises this to the retryable
branch.

## Two defects, and the timing separates them

**1. The budget is spent but never falls through.** 3 attempts is exactly the documented default
(1 + `DEFAULT_RETRY_COUNT`), so the budget *is* being counted; it just never surrenders to the error
slot. The reference says the slot "comes up only once the budget is spent" — it does not come up.

**2. No backoff is applied.** The three attempts land within **~5 ms** of each other (measured gaps
`3,2` ms and `12,2` ms across runs). `arm()` draws full jitter from `[0, ceiling]` with ceilings of
500 then 1000 ms. Two independent draws both landing at ~2 ms, reproducibly, is not jitter — no wait
is happening. This also defeats the stated purpose of the jitter (FND-02's thundering-herd
argument): every client hammers a struggling backend three times instantly.

## Where to look first (inference, not a proven root cause)

Defect 2 is the more informative one. `arm()` is the **only** thing in `RetryPolicy` that starts a
timer, and its wait is a jittered draw — so a ~2 ms gap says the re-resolutions that produced
attempts 2 and 3 **did not come through `arm()`'s timer**. Something else is re-resolving the island
immediately, while `accept()` — which is render-time and increments `spent` on each new generation —
spends the budget against it.

That would also explain defect 1: once the budget is gone, the fall-through to the error slot needs
a *further* render of the boundary to re-read `accept()`'s ruling. If whatever was driving the
immediate re-resolutions stops when the budget runs out, nothing triggers that render, and the
island sits on the last thing it showed — the loading slot — forever.

Worth checking in the boundary that calls `accept`/`arm`, not in `retryPolicy.ts` alone. Two
specific questions: whether `committed(version)` is firing between attempts (it calls `reset()`,
which restores the budget and would corrupt the accounting), and whether `accept()` is being reached
on a path where the matching `arm()` commit never happens.

A related inconsistency, noticed in passing and possibly the same seam: a **manual** retry on a
forced 500 produced 1 attempt, where the reference says the manual retry "buys a fresh budget" and
"starts the policy over". The mount path and the manual path disagree about whether the policy runs
at all.

## Why the consumer can't work around it

Nothing app-side is a real fix — the hang is in the policy. The blanket workaround (`retry: false`
on every island) throws away the feature the error classification was adopted to buy. jnana verified
its own half is correct in the running app (`okJson(500)` →
`ApiError { code: 'failed', retryable: true }` → `toSourceError` →
`{ code: 'failed', retryable: true }`) and recorded the defect rather than routing around it
(`jnana:FND-237`). It is shipping the classification with this outstanding.

## Verify

- A test at the boundary level, not the policy's unit level — the unit tests pass today. Mount an
  island whose load rejects with `{ retryable: true }`; assert the error slot renders after the
  budget, and that the attempts are separated by the backoff rather than landing in the same tick
  (fake timers make the second assertion exact).
- The `retryable: false` path is already correct — pin it in the same test so a fix can't trade one
  for the other.

## Resolution (2026-07-27)

Both defects reproduced deterministically at the boundary level once the tests left the suite's one
timing corner (jitter pinned at max, microtask rejection) for the live one (near-zero draws,
macrotask rejection). Root cause: after the retry timer fired, the boundary re-rendered once holding
the stale error under the new `resetKey` — the policy read that as the new generation already
failing, so it spent the attempt before its load ran and armed the next backoff *concurrently with
the attempt*. A draw shorter than the load's latency then fired that timer mid-flight: the in-flight
generation was discarded unjudged, an unbudgeted extra load ran after the budget was spent, and the
error slot mounted transiently at exhaustion. This yields exactly the measured 3-attempts-at-ms-gaps
signature.

Fix, two halves: the boundary clears the caught error in the same render pass
(`getDerivedStateFromProps`), so the stale-error render never exists; and the budget spend moved
from the render-time ruling (`accept`) to the commit-time `arm`, so a discarded concurrent render
spends nothing — the remaining suspect for the terminal hang, which jsdom never reproduced (every
ordering here ends at the error slot). Pinned in `retryPolicy.test.tsx` ("live-shaped timing"); both
pins fail on the pre-fix code.

Remaining (needs Chrome, the macOS guest): verify in the live jnana app that the hang is gone and
the manual-retry anomaly (1 attempt instead of a fresh budget) with it — `jnana:FND-237` is the
downstream tracker.
