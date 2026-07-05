# Design review & directions — July 2026

A framework-design pass over rati and its consumer Jnana (`~/Sites/jnana`), done while renames
and API changes are still cheap (no external users). Documentation only — nothing here is
implemented or committed to.

## What was reviewed

- rati: the public surface (`main.ts`), scope/mandala/source internals, the router, the
  legacy `data/` layer (`remoteData`, `ActiveData`, `apiUtils`), `stores/`
  (`RootStore`/`GlobalStore`), and the existing research docs.
- Jnana: `routes.tsx` (pages as routes), `pageScope` / `blockContentScope` +
  `BlockContent` (blocks as islands), the `FetchStore` family (`SpacesListStore`,
  `JobsListStore`, admin stores), `JnanaList.reconcileItems`, `ResourceContainer` /
  `ResourcePool`, and the `GlobalStoresContainer` / `useStores` / `LoginPage` import-cycle
  workarounds.

## The documents

- [improvements.md](./improvements.md) — options for future improvements and extensions,
  grouped per area, with code samples. Includes the mandala-owned advanced loading states
  (pending-after-timeout, stale indication) and the SSG / RSC direction note.
- [naming.md](./naming.md) — a review of every public-API name, with verdicts and a
  summary table of recommended renames.
- [data-package.md](./data-package.md) — design options for the companion data package
  that replaces the legacy `data/` layer and Jnana's `FetchStore`: refreshable + reactive
  queries, optimistic changes, keyed collections (the `reconcileItems` generalization),
  pagination.
- [stores-and-router.md](./stores-and-router.md) — the stores-container pattern: what it
  buys, what it costs, the router-induced dependency cycles, and options for resolving
  them (with a recommendation).
- [ssr-nazar-patterns.md](./ssr-nazar-patterns.md) — what nazar.ch (the first real rati
  SSR consumer) had to hand-roll, ranked for absorption: title management, hydration
  payload serialization, a `prerender` helper, match status for HTTP codes.

## Standing constraints (from the project's design intent)

- Plain-English naming mapped to concepts React devs already know; no coined terms in the
  public API (`mandala` stays internal).
- Resolution is all-or-nothing; components receive clean, fully-resolved props.
- Features wait for a real (Jnana-driven) need; speculative items are noted, not designed.
- Core stays MobX-free; MobX is fine in the companion data package.
