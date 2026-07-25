---
area: packages/rati/src/scope/source.ts (+ reference.md §Sources)
needs: nothing; DATA-11 builds on it
status: done
disposition: cut 2026-07-25 from the second-round migration feedback (maintainer-agreed design)
---

# DATA-10 — two-level `SourceError`: honor `retryable`, bless the code vocabulary

## Problem

`SourceError` already carries `retryable?: boolean` (source.ts:35) — preserved across the
SSR wire — but nothing reads or writes it, and `code` has only two blessed values
(`not-available`, `failed`). The jnana migration invented its own dialect
(`forbidden`, `unreachable` — see jnana `frontend/src/common/api/okJson.ts`) and had to
subclass `NotAvailableError` just to smuggle a custom code through `toSourceError`,
because that class is the only seam the mapper reads a `code` from ("the class name is
about the seam, not about the status" — jnana's own comment).

The agreed model is **two-level**: the top level is the transient/terminal axis
(`retryable` — what the retry gate consults, DATA-11), the flavor is the `code` (what
error slots switch on). Classification happens at the consumer's transport edge; rati
ships **no** fetch helper (DATA-08's decision) but must name the standard set so every
consumer stops inventing a private dialect.

## Scope

1. In `source.ts`, export a `SourceErrorCode` union:
   `'not-available' | 'forbidden' | 'invalid' | 'unreachable' | 'failed' | (string & {})`
   — completion without closing the set. `SourceError.code` stays `string` (or the
   union; whichever keeps augmentation-free inference — decide with a type test).
2. Give `toSourceError` a proper seam: any thrown `Error` carrying a string `code`
   (and optionally a boolean `retryable`) maps through with them intact — not just
   `NotAvailableError`. `NotAvailableError` keeps working unchanged. A plain `Error`
   without a code still maps to `{ code: 'failed' }` with `retryable` absent
   (= unclassified).
3. Document `retryable` on the `SourceError` interface: `true` = transient (worth
   retrying), `false` = terminal (an answer, not a fault), absent = unclassified.
4. reference.md §Sources: a short vocabulary table — code, meaning, typical HTTP
   origin (`not-available` 404/410 · `forbidden` 401/403 · `invalid` 400/422 ·
   `unreachable` network/failed-to-reach · `failed` 5xx + fallback), which are
   terminal vs transient, and a note that the status→code mapping is the consumer's
   transport edge (rati is transport-neutral; jnana's `okJson` is the worked example).
5. Tests: the new seam (plain `Error` subclass with `code`/`retryable` fields arrives
   in an island's error slot with both intact), plus the unclassified fallback.

## Boundaries

- No retry-policy change here — that is DATA-11.
- No fetch/HTTP helper of any kind (DATA-08 decided consumer-side).
- Don't remove or deprecate `NotAvailableError`.

## Verify

- `yarn ci fmt lint typecheck test` green.
- A load throwing `Object.assign(new Error('nope'), { code: 'forbidden', retryable: false })`
  renders the error slot with `error.code === 'forbidden'`; same via SSR dehydration.
- reference.md documents the five codes and the two levels.
