# SI-02 — `loadingDelayMs`

area: packages/rati/src/island/island.ts, src/router/route.tsx (RouteOptions),
      src/mandala/mandala.tsx + resolver.tsx, docs
needs: SI-03 (the kept-committed-bucket mechanism; the re-resolve half of the delay shows
       previous content, which is that mechanism)
disposition: cut 2026-07-19 from scope-and-island-directions.md §2

## Problem

Fast resolutions flash a spinner: the island renders the loading slot the moment resolution
starts, even when it settles in tens of milliseconds. The rehome of the legacy
`remoteData.indicatePendingAfterTimeoutMs`, renamed to point at the slot it modulates.

## Scope

1. **`loadingDelayMs?: number` on `island()` and `RouteOptions`** — per-island, not
   per-load: the aggregate phase is what the user sees.
2. **Semantics** (from the research doc, binding):
   - First load: render **nothing** until the delay elapses, then the loading slot.
   - Re-resolve (param change / refresh): render the **previous content** (SI-03's kept
     bucket) until the delay elapses, then the loading slot — unless `keepStale` is set, in
     which case the kept content stays for the whole re-resolution and the slot never
     appears (the composed contract: with both options, the loading slot appears only for a
     slow **first** load).
   - Resolution settling before the delay: no slot ever rendered, timer cancelled.
3. **Timer discipline:** cleared on settle, on unmount, on a superseding re-resolve; no
   `act()` leaks in tests (use fake timers where the suites already do).
4. **SSR:** under collect/prerender the delay is inert — the server waits for resolution
   regardless; the option must not change dehydration output. Pin that.
5. **Docs:** guide (loading-states section, with the interplay note delay × stale) and
   reference (island + route options). Consider a gallery page tweak only if an existing
   page can show it without noise — not required.

## Boundaries

- No per-load delays, no minimum-display-time option (the inverse feature) — not asked for.
- Don't change the default (no delay) — `loadingDelayMs: 0` and absent are identical.
- The status surface (`phase`/`isStale`) is SI-03's; this item only consumes it.

## Verify

- `yarn ci` green.
- Pins: fast first load renders content with no intermediate slot; slow first load renders
  nothing → slot at the deadline → content; re-resolve without `keepStale` shows previous
  content → slot; re-resolve with `keepStale` never shows the slot; unmount during the
  delay leaks no timer (vitest fake-timer assertion).
- SSR pin: dehydrated HTML and payload byte-identical with and without the option.
