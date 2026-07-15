# SSR-07 — head: the first client apply must not clobber the server head

area: packages/rati/src/head
needs: —
disposition: —

## Problem

`HeadProvider`'s effect runs `applyToDocument` while a route's Suspense boundary can
still be unhydrated. `snapshot('client')` counts only confirmed entries, finds none,
`defaultTitle` makes the result non-null — and the default is written over the correct
title the server put there (`domSync.ts` has no guard for "nothing confirmed yet").
The symmetric half is worse than the observed one: `reconcileMetas` would *remove*
server-rendered rati metas whose declarers haven't hydrated. SSR-05 narrowed the
repro: dehydrated async loads hydrate before the effect and are safe; the bug needs a
boundary still unhydrated when the effect fires — a source-backed page, a `lazy()`
chunk in flight, or React deferring the reveal on a large page (SSR-04's nazar case).

The store cannot distinguish "nothing declared yet" from "nothing will be declared" —
that was the recorded design question. Decision (maintainer, 2026-07-15): a distinct
hydration phase, not a bare first-apply guard, so the pure-CSR `defaultTitle` case
keeps working.

## Design

The store gets a phase: `hydrating` → `live`, one-way.

- **Detection**: `headTags` starts marking the `<title>` it emits with
  `data-rati-head` (harmless — `document.title` writes the same node; the marker's
  new job is evidence). On mount, before the first apply, `HeadProvider` checks the
  document for any `[data-rati-head]` tag: none → the page wasn't server-rendered by
  rati → the store settles to `live` immediately, and a CSR app gets `defaultTitle`
  exactly as today.
- **While `hydrating`**, the document is treated as server-owned: apply *declared*
  winners as they commit (title and metas update normally), but never write
  `defaultTitle` over the title, and never remove a managed meta that isn't (yet) a
  winner — its declarer may simply not have hydrated.
- **Settle on the first `remove()`**: an unmount can only follow that subtree's
  hydration, and it is the earliest signal the head is churning (a navigation, a
  conditional declaration leaving). From then on full semantics — defaults apply,
  orphaned server tags are reconciled away. Commits do *not* settle: on a
  multi-boundary page one boundary's commit says nothing about its siblings.

Cases this covers: the nazar large-page clobber (no commits yet → server head stands);
navigation to a page that declares nothing (the outgoing page's `remove` settles the
store → `defaultTitle` applies); an initial page that never declares anything (store
stays `hydrating`, document keeps the server-written default — same text). The one
documented caveat: a pure-CSR page that declares nothing never receives `defaultTitle`
— put the default in `index.html` too.

## Scope

1. `HeadStore`: the phase, settled by `remove()`; a way for the provider to settle it
   on mount (CSR detection). Snapshot (or a sibling) must let `domSync` tell a
   declared title from the default.
2. `domSync.applyToDocument`: the `hydrating` behavior above.
3. `headTags`: mark the emitted `<title>`.
4. Tests pinning: server-marked head + no commits → untouched; commit during
   `hydrating` updates without removals; first `remove` settles (default applies,
   orphans reconciled); no marker → `live` from the start (CSR default works).
5. `docs/public/ssr.md` §Titles and meta: the server-owned-until-churn behavior and
   the CSR caveat, in one short paragraph.

## Boundaries

- No global "hydration finished" listener, no router coupling — the head layer stays
  standalone; `remove()` is the only churn signal.
- Don't touch the seq/dedupe semantics or the server snapshot.

## Verify

`vp run rati#test` green; the new tests demonstrably red against today's `domSync`
(no phase). `vp run rati#typecheck` + `vp lint`.
