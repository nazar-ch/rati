# SI-06 — SSR error dehydration (`ssrErrors`)

area: packages/rati/src/mandala/{hydration.tsx,resolver.tsx,boundary.tsx}, src/ssr
      (payload/renderApp as needed), src/island/island.ts, src/router/route.tsx,
      examples/ssr, docs
needs: SI-05 (serial lane — shared boundary.tsx; a dehydrated error must respect the retry
       policy switch)
disposition: cut 2026-07-19 from scope-and-island-directions.md §2 (marked wait-for-need;
             cut anyway — README §Decisions). The shipped baseline it extends is recorded
             there: rejected loads → collector `errors` → status mapping; HTML degrades to
             the loading slot with React's client-retry marker; the client re-runs the load
             on hydration (pinned by `islandSsrErrors.test.tsx`).

## Problem

The shipped baseline is self-healing but non-deterministic for the user: an SSR-failed load
ships a spinner and silently retries client-side — good default, wrong for consumers who
want a deterministic first paint (render the error slot immediately, with `retry`). The
research doc's two "options beyond the baseline" are one feature with two defaults:
dehydrating the error is exactly what disabling the automatic client retry requires.

## Scope

1. **`ssrErrors?: 'retry' | 'dehydrate'` (default `'retry'`) on `island()` /
   `RouteOptions`.** `'retry'` is the shipped baseline, untouched. `'dehydrate'`:
   - the server catches the rejection at the **resolver** level (the boundary never runs
     server-side) and records the normalized `SourceError` for that cell;
   - the wire format grows a third section carrying dehydrated errors (versioned the same
     way as the existing sections; the payload escaping rules apply — this is
     user-influenced data crossing into HTML);
   - the server HTML renders the island's **error slot** (deterministic first paint);
   - the client hydrates the cell straight to its error state (`buildCell` hydrate-to-error
     path) — no automatic re-run; the error slot's `retry` is armed and re-runs the load on
     click.
2. **Status mapping unchanged:** a dehydrated error still counts in `renderApp`'s
   `errors` → HTTP status derivation (a 500 with a rendered error slot is still a 500).
3. **Interaction with SI-05:** a dehydrated error on an island with a retry policy — decide
   and pin whether the client policy picks it up (recommended: yes, the policy doesn't care
   where the error came from) or dehydration implies no auto-retry.
4. **Serialization limits:** `SourceError` normalization must produce a wire-safe shape
   (no live Error objects, no cause chains with functions); document what survives the trip.
5. **Gallery:** the existing error-slot page (or a variant) runs with `'dehydrate'` to show
   the server-rendered error slot; docs: `docs/current/public/ssr.md` + reference options;
   internals for the wire section.

## Boundaries

- The default stays `'retry'` — `islandSsrErrors.test.tsx` must pass unmodified; any edit to
  it means the default moved, which is out of contract for this item.
- No streaming, no partial-response semantics; `prerender` stays all-or-nothing.
- `not-available` handling: the 404 mapping is already decided; `'dehydrate'` changes what
  the client paints, not the status.

## Verify

- `yarn ci` green; `islandSsrErrors.test.tsx` untouched and green.
- Pins: `'dehydrate'` round-trip — server error slot in HTML, third wire section present and
  escaped (the payload escaping tests extend to it), client hydrates to the error slot with
  no load re-run and no hydration mismatch; `retry` click re-runs and recovers; the SI-05
  interaction pinned whichever way it is decided; status derivation unchanged for both
  modes.
