---
area: packages/rati/src/router/RouterOutlet.tsx
needs:
status: open
disposition: —
---

# SI-07 — the outlet's deferral gets a ceiling that commits on the sync lane

`RouterOutlet` defers the active route with `useDeferredValue`, so a navigation whose target has not rendered yet keeps the previous screen and suppresses every fallback. The deferral has no ceiling: a target that never renders leaves the previous screen up forever with nothing to say a navigation happened. jnana measured this on an iOS device where React's scheduler channel had died across a suspend: every navigation advanced the router and produced one sync render of the outlet, and the deferred render never ran, for any route (jnana:///docs/research/ios-suspend-message-channels.md §1).

The product want it answers is jnana's ⭑APP-31: a navigation the app cannot finish within a second shows the target's loading state, so no tap is ever silent.

## Scope

1. The outlet commits the current route directly once the deferred route has lagged it past a ceiling, so the target's own loading slot, or the outlet's `Loading`, shows. The ceiling is one exported constant with its why beside it.
2. The ceiling's commit must not go through React's scheduler: a timer that sets React state schedules a default-lane render, which is exactly what a dead scheduler never runs. The lag is measured and the commit forced through a `useSyncExternalStore` subscription or an equivalent sync-lane path, so it works when only sync renders do.
3. Once the deferred route catches up, the outlet returns to deferring, so the fast-load case keeps its no-flash behavior.
4. The router suspense suite pins: a target that stays suspended past the ceiling shows `Loading`; a target that resolves inside the ceiling never flashes it; the forced commit happens with the scheduler's `MessageChannel` stubbed to deliver nothing.

## Boundaries

- No change to islands, scopes or the mandala; the ceiling lives in the outlet.
- No new dependency; the sync-lane path uses React's own primitives.

## Verify

- `vp test packages/rati/src/__tests__/router/routerSuspense.test.tsx` and the router fuzz suite green, with the three new cases.
- Kill step: remove the forced commit and confirm the past-the-ceiling case goes red.
- `vp run verify` green; a release with the change so jnana can bump its pin.

## Where

- The rati checkout, `~/rati` on a guest; jnana consumes the release through its `rati` pin.
