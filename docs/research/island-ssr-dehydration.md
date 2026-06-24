# Island SSR dehydration — keep the bespoke registry, or move to React's data path?

> Decision note. **Decision: keep the current mechanism for now.** This documents what it
> is, the React-native alternative, and the trade-offs, so the move can be made deliberately
> later. (The mechanism lives in `mandala/hydration.tsx`; see
> [internals.md](../internals.md#ssr-dehydration-mandalahydrationtsx).)

## What we do today (kept)

Island promise loads are dehydrated through a small, framework-owned registry on the
mandala's `Step` tree:

- **Server.** `IslandHydrationProvider collect={…}` wraps the app. Under a Suspense-awaiting
  render (`react-dom/static` `prerender`), each `Step` that unwraps a promise with `use()`
  calls `collect(mandalaId, key, value)`. The key is the mandala's `useId()` (stable by tree
  position across server/client) then the scope key. Result: a flat
  `Record<mandalaId, Record<scopeKey, value>>`.
- **Client.** The same `IslandHydrationProvider data={…}` feeds that registry back. On the
  first mount each `Step` short-circuits a dehydrated key to a value cell — skipping the load
  (no re-fetch) and `use()` (no re-suspend) — so hydration produces the server HTML
  synchronously.
- **Scope.** Only *promise* loads are serialized. A *source* is a live state machine: it stays
  pending under SSR and resolves on the client after hydration, so there's nothing to carry.
  `hook()` loads run on both sides and aren't serialized.

It's orthogonal to the router (a route is just a mandala), so route SSR and standalone island
SSR participate the same way. ~75 lines in `mandala/hydration.tsx`.

## The alternative: React's built-in SSR data path

"Use React's data path" really means one of:

1. **React Server Components / Flight.** RSC serializes the component tree + data over the
   wire natively, including Suspense. The closest thing to "automatic dehydration." But it's a
   different architecture: a server-component layer, a bundler integration (Flight), and a
   server runtime. rati is a client framework rendered with `react-dom/static` +
   `react-dom/client`; adopting RSC is a large, separate project.
2. **`renderToPipeableStream` + streamed inline scripts.** React can stream HTML and flush
   `<script>` chunks as Suspense boundaries resolve. You still serialize the data yourself and
   read it back on the client — essentially what the registry already does, minus the mandalaId
   keying, plus streaming.
3. **`useId` + a single serialized blob** (what we have). Not "React built-in" so much as
   "built on React's `useId`."

So for a non-RSC app there is **no drop-in built-in** that removes the hand-rolled
serialization; the realistic options are "keep the registry" or "adopt RSC."

## Trade-offs

| | Keep the registry (current) | Move to RSC/Flight |
| --- | --- | --- |
| Effort | none (done) | large — new server layer + bundler integration |
| Architecture fit | matches today's `prerender` + `hydrateRoot` | requires a server-component split rati doesn't have |
| Streaming | no (collect-then-embed after the render settles) | yes (progressive flush) |
| Data we serialize | only island promise values, explicitly | framework-managed, broader |
| Coupling | island-owned, router-orthogonal, ~75 LOC | deep framework/runtime coupling |
| Tests | covered (`hydration`, `ssrRender`, `islandSsr`) | new test surface |
| Risk | low, proven | high, exploratory |

## Recommendation

**Keep the registry.** It's small, proven, router-orthogonal, and passes the SSR test suite.
The only compelling reason to switch is **streaming SSR** (progressive flush of slow islands)
— and that's better pursued as a deliberate RSC adoption with its own plan, not as a rider on
the resolver.

Revisit when: (a) we want streaming SSR for slow above-the-fold islands, or (b) we adopt RSC
for other reasons and want one data path. Until then the registry stays.

## If we do move later

- The `Step` tree already lines up with a streaming model: `use(promise)` boundaries are
  exactly the Suspense points React would flush at.
- Keep `Source` loads client-only regardless (they're live, not serializable) — any data path
  only ever carries the promise values.
- The mandala `useId` keying generalizes; an RSC path would replace the manual `collect`/`data`
  plumbing but keep the "promise values only, keyed per mandala" shape.
