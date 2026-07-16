# RF-07 — relative navigation strings: one platform, one resolution

area: packages/rati/src/router (history.ts, store.ts, Link), docs/public/reference.md
needs: — (RF-06 landed)
disposition: cut 2026-07-16 (round-2 review); decision taken — coherent passthrough

## Problem

Strings are platform-passthrough today ("used verbatim"), and the platform resolves a
relative reference against the *current URL* — but only in the browser.
`createMemoryHistory` parses every input against a fixed placeholder origin
(`new URL(url, 'http://_')`), so the two `History` implementations disagree on every
relative string: `push('sub')` from `/a/b/c` lands on `/a/b/sub` in the browser and on
`/sub` in memory (confirmed by hand, round-2 review). SSR, tests, and the fuzz model all
run on the memory semantics — including the `Location` header a relative redirect target
produces on the server.

Worse, and confirmed against the real store: **a relative self-target bypasses RF-06's
1-cycle check.** `route('/self', …, { redirect: { to: 'self' } })`, navigated to from
`/home`: the comparison sees `'self' !== '/self'`, follows, the platform resolves the
replace back to `/self`, and the nested `setPath` takes the same-path early return — the
exact stale-route shape RF-06 fixed (`activeRoute` stays `home` at URL `/self`), one hop
recorded, **no loop reported**. The fix compared the *spelling*, not the resolution.

Decision (maintainer, 2026-07-16): **coherent passthrough** — relative strings stay
platform-resolved (no route-hierarchy semantics; rati's table is flat and named routes +
`ContextualLink` are its relative story), but every surface resolves them the same way
the browser does, and `<Link to="..">` is functional rather than merely tolerated.

## Scope

1. **Memory history resolves relative inputs against its current entry**, matching
   `pushState`. `parse` gains the current entry's URL as the base. Pins, on the History
   surface: `push('sub')` from `/a/b/c` → `/a/b/sub`; `push('../x')` → `/a/x`;
   `push('?q')` and `push('#h')` keep the pathname; `replace` the same; an absolute
   input is unchanged.
2. **The self-redirect comparison resolves the target the way the history will** before
   comparing, so a relative spelling of a 1-cycle is the same 1-cycle. Pin: the
   confirmed bypass shape — `to: 'self'` at `/self` → loop reported, the route's own
   component rendered, one hop.
3. **`<Link to="..">` works and is documented.** A pin that clicking it navigates one
   segment up (both histories now agree on where that is); define what `isPath`/active
   state mean for a relative `href` (resolve before comparing, or document the
   limitation at the prop). reference.md §Routing: the string rule gains the sentence —
   a relative string is resolved by the platform against the current URL; prefer
   absolute paths or `getPath` for anything the app builds.

## Boundaries

- No route-hierarchy relative routing (React Router's `relative="route"` has no pull in
  a flat table). `..` means what the URL parser says it means.
- The fuzz arbitrary keeps drawing absolute URLs — relative strings are pinned
  deterministically, not modeled; a comment at the draw says so and why.
- The altitude rule binds.

## Verify

- `yarn ci` green; each pin red with its fix reverted (executed once, noted at the test).
- The RF-02 memory-history pins still pass unchanged (absolute inputs are unaffected).
