---
area: packages/rati/src/router (Link.tsx, store.ts, Navigate.tsx), docs/public/reference.md
needs: — (RF-06 landed)
status: done
disposition: cut 2026-07-16 (round-2 review); decision corrected 2026-07-17 — the router does not support relative strings; `<Link>` resolves them at the platform surface that owns them, the anchor
---

# RF-07 — relative strings: the anchor resolves, the router refuses

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

The first cut of this item read those findings as "make every surface resolve like the
browser" — teach the memory history to resolve against its current entry, resolve inside
the 1-cycle comparison, and thereby make relative strings a *supported router input*.
That was a misunderstanding of the decision. The router does not support relative
strings — not in `navigate`/`replace`, not in `redirect.to`, on neither `History` — and
no surface grows resolution semantics. What must work is `<Link to="..">`: an anchor is
a platform element, and the platform defines what its relative href means.

Decision (maintainer, corrected 2026-07-17): **the anchor resolves, the router
refuses.** Resolution belongs to the platform surface that owns the reference — the
rendered `<a>`. The router's string vocabulary is absolute paths; a relative string
handed to it is an error, not an input to interpret. No route-hierarchy semantics
either way — rati's table is flat, and named routes + `ContextualLink` are its
relative story.

## Design — no resolution code anywhere

`<a href="..">` is already resolved by the DOM: the anchor's `href` IDL property (as
opposed to `getAttribute('href')`) is the absolute URL the browser would navigate to —
the status bar shows it, cmd-click opens it, and `shouldHandleLinkClick` already builds
`new URL(anchor.href, …)` for its origin check. The bug is one line past that: after
deciding to intercept, the handler navigates to the raw prop (`router.navigate(href)`
with `".."`) instead of the URL the anchor resolved. The fix reads the platform's
answer back out of the DOM:

```ts
const url = new URL(event.currentTarget.href);
router.navigate(url.pathname + url.search + url.hash);
```

The router only ever receives absolute paths, so its contract holds with zero
resolution code added to rati. `..` means exactly what the URL parser says, and the
pushed path is byte-identical to where the unintercepted click would have gone —
including the dot-segment normalization `pushState` applies itself. A Navigation API
interception hands over exactly this shape (a resolved destination URL), which
`shouldHandleLinkClick`'s comment already claims to mirror.

## Scope

1. **Link navigates to the anchor's DOM-resolved URL.** The intercepted click pushes
   `pathname + search + hash` of `new URL(event.currentTarget.href)`; the prefetch
   handlers (hover/touch) read the same, so `prefetch` on a relative link matches the
   real route. Pins: `href=".."` at `/a/b/c` pushes `/a/`; an absolute href pushes
   unchanged; `href="?q"` / `href="#h"` keep the pathname.
2. **Active state resolves before comparing.** `isPath` gets the raw spelling today, so
   a relative href is silently never active. Link resolves the href prop against the
   router's current URL — `new URL(href, 'http://_' + basename + path + search)`, the
   same parser with the base the anchor would use, no `window`, SSR-safe, agrees with
   the click by construction — and bails to inactive when the resolution leaves the
   placeholder origin (an external absolute href). Pin: a relative same-page spelling
   (`href="c"` at `/a/b/c`) is active; `href=".."` there is not.
3. **The router refuses the strings it doesn't support.** A string target to
   `navigate`/`replace` (and so `<Navigate>`) or `redirect.to` must begin with `/` —
   otherwise a framework-shaped error naming the alternatives (a named route /
   `getPath`; `setSearchParams` for query updates; `<Link>`/an anchor when
   platform-relative is meant). RF-08's precedent: at the choke point, an input the
   contract cannot honor gets an error, not a silent misnavigation. This closes the
   confirmed 1-cycle bypass by refusal — `redirect: { to: 'self' }` throws where the
   redirect is followed; a spelling can no longer walk past the comparison. The memory
   history is untouched: its placeholder parse is correct for the input class that
   remains. `getPath`'s string form stays verbatim — it feeds `href` attributes (the
   `ContextualLink` path), and an anchor is exactly where a relative string is legal.
4. **reference.md §Routing**: the string rule — router-facing strings are absolute path
   references, refused otherwise; a relative reference belongs on `<Link>`/an anchor,
   where the platform resolves it against the current URL.

## Boundaries

- **No relative-resolution code in the router or either `History`.** The two-histories
  divergence stays recorded as the *reason* the input class is refused — two hosts can
  only disagree about input we accept.
- No route-hierarchy relative routing (React Router's `relative="route"` has no pull in
  a flat table). `..` on an anchor means what the URL parser says it means.
- The fuzz arbitrary keeps drawing absolute URLs — now matching the enforced contract
  rather than sidestepping a gap; the comment at the draw says so.
- The altitude rule binds.

## Verify

- `yarn ci` green; each pin red with its fix reverted (executed once, noted at the test).
- The RF-02 memory-history pins still pass unchanged (absolute inputs are unaffected).
