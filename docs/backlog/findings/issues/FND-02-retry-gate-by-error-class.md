---
area: packages/rati/src/mandala/retryPolicy.ts, packages/rati/src/scope/source.ts (the `retryable` flag); packages/rati/src/data if a status classifier lands there
needs:
status: open
disposition: —
---

# FND-02 — gate automatic retries by error class: spare terminal 4xx, be gentler with 5xx

## Problem

The automatic retry policy (SI-05, `packages/rati/src/mandala/retryPolicy.ts`) decides whether a
failed load earns another attempt from the error **code** alone:

```
// retryPolicy.ts:86 — RetryPolicy.accept()
this.accepted = code === 'failed' && this.spent < this.count;
```

`'failed'` is the catch-all code. `packages/rati/src/scope/source.ts` `toSourceError()` maps
`NotAvailableError` → `'not-available'` and **every other** `Error`/rejection → `'failed'`. So the
only failure the policy declines is one a load explicitly threw as `NotAvailableError`; everything
else is retried up to `count` times.

rati core is transport-agnostic — it has no notion of HTTP status. A typical load fetches and
throws on `!res.ok`, so a plain `throw new Error(...)` for a **400 / 401 / 403 / 404 / 422** lands
as `code: 'failed'`, indistinguishable from a **500** or a network drop. The policy then hammers
the request with `count` identical attempts on the terminal ones — a 403 will not become a 200 in
500ms, and a 400 is deterministically wrong input. The error (and, for a route, the 404 or 403 the
user is owed) is only delayed.

The 5xx / network case *is* worth retrying, but the backoff is bare exponential
(`backoffMs * 2 ** (spent - 1)`, retryPolicy.ts:111) — no jitter, no cap, no `Retry-After` / 429 /
503 hint. Many islands failing together (a backend blip) re-fire on the same synchronized schedule,
a small thundering herd back at a server that is already struggling.

Note the plumbing is half-built: `SourceError` already carries an unused `retryable?: boolean`
(source.ts:35), even preserved across the SSR dehydration wire
(`packages/rati/src/mandala/hydration.tsx` `wireError`, line 173) — but `accept()` never reads it.

## Why it matters

Retrying terminal client errors is pure latency the user pays for nothing, and it turns one bad
request into `count`+1 — the opposite of what you want against an auth wall or a rate limiter.
Un-jittered synchronized retries against a 5xx'ing backend add load exactly when it is least able to
take it. The current single knob (`failed` vs `not-available`) can express neither "this is
terminal, stop" nor "this is transient, be gentle."

Adjacent to `docs/planned/production-review/issues/REV-02-failure-modes-and-messages.md` (failure
modes & messages), which reviews this surface but does not itself change retry behavior.

## Options

Not yet decided; whichever is taken, the check is that a terminal failure (4xx-class) reaches the
error slot with no extra attempts, while a transient one (5xx / network) still retries:

1. **Honor the existing `retryable` flag.** Have `accept()` consult `error.retryable`: `false` ⇒
   never retry (even `failed`), `true` ⇒ retry (even a non-`failed` code), `undefined` ⇒ today's
   code rule. No new public surface, and the flag already crosses the SSR wire — a dehydrated
   terminal error would stay terminal on the client.

2. **A `shouldRetry` predicate on `RetryOptions`.** `retry: { count, backoffMs, shouldRetry?:
   (error, attempt) => boolean }`, defaulting to the current `code === 'failed'`. Most flexible and
   per-island, but pushes classification onto each call site.

3. **Classify at the transport edge.** Only `packages/rati/src/data` does real fetching — let it map
   HTTP status → code / `retryable` (4xx terminal; 5xx / 429 / network retryable) so the flag
   arrives correct and rati core stays transport-agnostic. Pairs with option 1.

4. **Gentler 5xx backoff.** Add jitter to the exponential schedule and optionally a
   `Retry-After`-derived floor for 429 / 503; consider a max backoff cap. Independent of 1–3.
