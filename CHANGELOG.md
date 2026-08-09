# Changelog

What breaks and what it maps to, per release, because rati is pre-1.0 and a minor bump under a caret
range lands on consumers automatically. Removals are listed with their replacements; additions only
when a consumer needs to act. Started at 0.6.3 (FND-05); earlier releases are not reconstructed.

**Write the entry when you make the change, not when you release it** — in the `## Unreleased`
section below, in the same commit as the behavior. Releasing then only retitles that section (the
step is in docs/current/RELEASING.md); it is never the moment the notes get *written*. 0.7.0 is why:
the release-time step was the whole convention, the first release after it shipped with no entry at
all, and the consumer that adopted it read `git log v0.6.3..v0.7.0` instead. An empty
`## Unreleased` at release time is a real answer — it means nothing consumer-visible changed, and
the entry says so in one line.

## Unreleased

Nothing yet.

## 0.8.0 — 2026-08-09

Fixed:

- **Published `.d.ts` re-exports resolve under `moduleResolution: nodenext`** (jnana-kit:KC-42).
  Every relative specifier in the emitted declarations was extensionless
  (`export … from './requestHandler'`), which `nodenext` cannot resolve. `skipLibCheck` hid the
  failure rather than reporting it, so a consumer on that resolution type-checked the whole
  `rati/server` surface against `any` — no errors, no completions, no protection. The declarations
  carry explicit `.js` specifiers now. Nothing to migrate, but expect this bump to *surface* type
  errors the `any` was masking; they were always there.

## 0.7.0 — 2026-07-29

Four consumer-reported defects, no removals — nothing to migrate. Backfilled 2026-07-29 from
`git log v0.6.3..v0.7.0`; the release itself shipped without an entry, which is what moved the notes
to the `## Unreleased` discipline above.

Fixed:

- **`ActiveRoute` now narrows** (FND-06). It reached the app's route table through an `infer`
  conditional, which left the type deferred: `activeRoute.name === 'page'` filtered nothing, and
  reading a param off the "narrowed" route failed as an unrelated-looking `TS7053` index error. It
  resolves the table by indexed access now. An app carrying a re-derive-off-`RatiUserTypes`
  workaround can drop it.
- **A `retryable: true` island failure reaches the error slot** (FND-07). It spent its retry budget
  and then sat on the `loading` slot forever — no message, no Retry button — and the backoff never
  applied, so all three attempts landed within ~5 ms. The boundary's stale-error render was spending
  the next attempt before its load ran, and arming the backoff concurrently with it.

Added:

- `keyed(...).delete(key)` (FND-08) — drop one instance, for the caller that knows a key is spent (a
  closed detail view, a deleted entity). Same contract as `reset()`, one key at a time; it does not
  call into the instance. Keeps `keyed` usable for a bounded-but-shrinking map, which previously had
  to stay a hand-rolled `Map`.
- `back()` / `forward()` / `go(delta)` on `Router` (FND-04), so history traversal has a sanctioned
  home and `router.history` has no remaining use.

## 0.6.3 — 2026-07-25

The stores subsystem left the package: apps own their store container, and the router is the one
store rati still provides ([docs/research/stores-and-router.md]
(docs/research/stores-and-router.md)).

Removed → replacement:

- `RootStore`, `RootStoreProvider`, `GlobalStore`, `GlobalStores`, `GenericStoresContext`,
  `createUseStoresHook`, `useGenericStores` → own your store container; hand it to scopes with a
  `hook()` load (`hook(() => useStores())`).
- `RouterStore` (the class export) → internal. Hold `Router` (the interface) instead; `createRouter`
  builds it. As of FND-04 the traversal methods (`back`/`forward`/`go`) are on `Router`, so
  `router.history` has no remaining sanctioned use.
- `rati/testing`'s `storesWrapper`, `renderWithStores`, `PartialStores` → `renderIsland` / your own
  provider wrapper.

Renamed:

- **`Router` changed meaning.** In 0.6.2 it was the outlet *component*; it is now the router
  *interface type*, and the outlet is `RouterOutlet`. A stale `import { Router }`
  - `<Router />` keeps resolving and fails as "a type imported as a value" — the error points at the
    usage, not the removal. Swap the JSX to `<RouterOutlet />`.
- `RouterStoreOptions` → `RouterOptions`; `createTestRouter`'s options changed with it.
