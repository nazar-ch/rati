---
area: packages/rati/src/mandala/retryPolicy.ts (+ island docs: reference.md §retry)
needs: DATA-10 (the retryable semantics it gates on)
status: done
disposition: cut 2026-07-25 from the second-round migration feedback; absorbs docs/backlog/findings/issues/FND-02-retry-gate-by-error-class.md
---

# DATA-11 — default-on retry, gated by error class, jittered

## Problem

Retry today is opt-in per island (`retry: { count, backoffMs }`) and gates on
`code === 'failed'` alone (retryPolicy.ts `accept()`), so a configured island hammers
terminal 4xx failures with identical attempts (FND-02), and an unconfigured island —
the normal case — retries nothing. The maintainer's call: **retry should "just work"
by default** — less boilerplate, not more — and the two-level error model (DATA-10)
is what makes that safe: the gate can tell a transient fault from an answer.

## Scope

1. Default policy, no config needed: an island with no `retry` option automatically
   retries a failure whose `error.retryable === true` — approximately
   `{ count: 2 }` with jittered exponential backoff (full jitter over
   `backoffMs * 2 ** attempt` with a sensible base, plus a cap; FND-02 option 4).
   An unclassified `failed` (plain `throw new Error`) does **not** auto-retry — for
   an app that never classifies, default-on retry would hammer its 404s exactly as
   FND-02 describes. Classifying at the transport edge is how an app buys the
   default.
2. Explicit `retry: { count, backoffMs }` keeps the broader legacy reach — retries
   anything with `retryable !== false` (so unclassified `failed` retries, and a
   classified terminal error now correctly does not; this is the FND-02 fix for
   configured islands). Jitter applies here too.
3. An opt-out: `retry: false` (or `count: 0`, which already means off) disables the
   default policy for an island.
4. Everything else about the policy is unchanged: retrying renders the loading slot
   (not the error slot), `useScopeControls().retrying` counts attempts, the manual
   `retry` buys a fresh budget, budgets restore on commit/input change, client-only.
5. reference.md §retry rewritten: default-on behavior first, the class gate (replaces
   the "`failed` only" bullet), the explicit-config and opt-out forms, the jitter.
   Cross-link the DATA-10 vocabulary.
6. Tests: terminal (`retryable: false`) reaches the error slot with zero extra
   attempts under both default and explicit config; `retryable: true` retries with
   no config; unclassified retries only under explicit config; jitter stays within
   bounds (seedable or bounds-asserted).

## Boundaries

- No `Retry-After`/429 hint plumbing (rati never sees response headers; the consumer
  can express it via `retryable` only) — note it in the record if it comes up.
- No `shouldRetry` predicate option (FND-02 option 2 — not taken; the flag is the
  contract).
- `SourceError` shape changes belong to DATA-10.

## Verify

- `yarn ci fmt lint typecheck test` green.
- The FND-02 acceptance check: a 403-shaped failure (`retryable: false`) reaches the
  error slot with no extra attempts; a 5xx-shaped one (`retryable: true`) retries —
  on an island with **no** retry config.
- Finishing commit flips FND-02's record to `status: done` alongside this one.

## As landed (2026-07-25)

Two notes for whoever reads this next.

- **Explicit config reaches the unclassified `failed`, not every unflagged code.**
  Item 2 said "anything with `retryable !== false`"; taken literally that would start
  retrying `not-available`, which contradicts the doctrine this record repeats (an
  answer is not a fault) and the pin that has held it since SI-05. So the gate is
  FND-02 option 1 verbatim: the flag decides wherever the app set it, and for an
  unclassified failure the reach decides — the default policy declines, an explicit
  one falls back to the legacy code rule (`failed` only). The intent of item 2 —
  unclassified `failed` retries, a classified terminal one no longer does — holds.
- **Numbers:** `count: 2`, `backoffMs: 500` (now optional — the first *ceiling*), full
  jitter over `min(10s, backoffMs * 2 ** (attempt - 1))`. The `Retry-After` gap the
  Boundaries called out is stated in reference.md §retry: rati never sees response
  headers, so a rate limiter's advice arrives only as `retryable`.
