# Changelog

What breaks and what it maps to, per release — written *with* the release (the step is in
[docs/current/RELEASING.md](docs/current/RELEASING.md)), because rati is pre-1.0 and a
minor bump under a caret range lands on consumers automatically. Removals are listed with
their replacements; additions only when a consumer needs to act. Started at 0.6.3
(FND-05); earlier releases are not reconstructed.

## 0.6.3 — 2026-07-25

The stores subsystem left the package: apps own their store container, and the router is
the one store rati still provides ([docs/research/stores-and-router.md]
(docs/research/stores-and-router.md)).

Removed → replacement:

- `RootStore`, `RootStoreProvider`, `GlobalStore`, `GlobalStores`, `GenericStoresContext`,
  `createUseStoresHook`, `useGenericStores` → own your store container; hand it to scopes
  with a `hook()` load (`hook(() => useStores())`).
- `RouterStore` (the class export) → internal. Hold `Router` (the interface) instead;
  `createRouter` builds it. As of FND-04 the traversal methods (`back`/`forward`/`go`)
  are on `Router`, so `router.history` has no remaining sanctioned use.
- `rati/testing`'s `storesWrapper`, `renderWithStores`, `PartialStores` → `renderIsland`
  / your own provider wrapper.

Renamed:

- **`Router` changed meaning.** In 0.6.2 it was the outlet *component*; it is now the
  router *interface type*, and the outlet is `RouterOutlet`. A stale `import { Router }`
  + `<Router />` keeps resolving and fails as "a type imported as a value" — the error
  points at the usage, not the removal. Swap the JSX to `<RouterOutlet />`.
- `RouterStoreOptions` → `RouterOptions`; `createTestRouter`'s options changed with it.
