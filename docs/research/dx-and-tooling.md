# DX & tooling — directions

> **Being executed** — cut 2026-07-19 as the
> [testing-and-dx effort](docs/planned/testing-and-dx/README.md), grounded in a survey of
> what both repos hand-roll (recorded there) and grown by one member this doc missed (an
> SSR round-trip test kit). Where a record and this doc disagree, the record wins.

Small, high-leverage developer-experience items. **None built yet** (verified against the
source: no `rati/testing` entry, no `dataTrace`, and only the mandala wrapper — not its inner
`Step` components — carries a React `displayName`). From the July 2026 review, `improvements.md`
§7.

## Test utilities (`rati/testing`, or exported from the package root)

The highest-value DX item. Jnana's tests and rati's own `__tests__` both hand-roll these today:

- a **controllable source** — `controlledSource<T>()` with `.setReady(v)` / `.setError(e)` /
  `.reset()`;
- an **island render harness** — `renderIsland(island, { props })` wiring the providers;
- a **memory-router harness** — `createTestRouter(routes, { url })`.

Pairs with the data package's "testability by construction" ground rule (every primitive is
producer-driven, so a deferred-promise fake walks it through every phase — see the archived
[data-package.md](docs/archive/directions-2026-07/data-package.md)).

## Resolution tracing (`dataTrace`)

A sibling to the shipped `navTrace` (the `rati/debug` entry): per-island logs of level
starts/settles with timings, making waterfalls visible. Cheap; helps tuning level placement
(the "where a prop is declared" performance knob).

## DevTools naming for `Step` components

Islands already carry a `displayName` (`Island(…)` / `Route(…)`, set on the mandala wrapper).
Extending it to the inner `Step` components (`Step(users,tree)`) makes the React DevTools tree
self-describing. Trivial.
