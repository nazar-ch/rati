# router-fuzz — randomized testing for the router, plus the hardening it starts from

Cut 2026-07-15. Per-item status derives from rati git (`git log --grep 'RF-'`) — never from
this file; conventions below.

The second fuzz target, unblocked by [mandala-fuzz](../mandala-fuzz/README.md) proving the
harness pattern: an `fc.commands` model over navigation interleavings (push / replace /
back-forward / redirects / shallow navigations / state), plus the deterministic pins the
seams need and a small hardening item the pre-cut review produced. The discipline carries
over wholesale — the altitude rule, kill-tested invariants, `fuzz(n)` budgets with
`FUZZ_RUNS` / `FUZZ_LEVEL` / `FUZZ_SEED`, jnana's fuzz conventions
(`~/Sites/jnana/.claude/fuzz-testing.md`) — and the strategy record for *why* these shapes
work is [mandala-testing.md](../../archive/mandala-testing.md); this effort does not
duplicate it.

The subject is `packages/rati/src/router/`: `RouterStore` (matching, redirects, the
skip-marker shallow navigations, per-entry state), the two `History` implementations,
`Router`/`Link`/`Navigate`, scroll restoration's key bookkeeping, and the `prepareRoute`
SSR seam. The deterministic base is already broad (21 suites under `__tests__/router/`);
the fuzz suite hunts what those can't: interleavings and traversal histories no hand-written
sequence thinks to try.

## Review findings, 2026-07-15 (pre-cut router review)

The review that preceded this cut read the whole router surface. Four product findings and
one harness gap — none silently fixed; RF-01 carries them, with the one real semantics
decision as its entry gate:

1. **Route params are neither encoded nor decoded.** `getPath` interpolates raw values
   (`{ id: 'hello world' }` → `/pages/hello world`), and `getActiveRoute` hands back raw
   match groups — so the browser's own percent-encoding round-trips into the component
   (`hello%20world`). Symmetric encode/decode is the obvious fix, but it is a behavior
   change consumers can observe (jnana's Base64Uuid params are unaffected either way) —
   the user decides the semantics before RF-01 executes.
2. **`getPath`'s substitution has a prefix-collision bug.** `path.replace(':id', v)` on a
   path whose *earlier* segment is `:idx` corrupts it (`/x/:idx/:id` → `/x/7x/:id`) —
   `String.replace` finds the first substring, not the parameter boundary.
3. **`getPath` with an unknown route name throws an opaque TypeError** (a non-null
   assertion on `find`). A framework-shaped error names the route instead.
4. **`createBrowserHistory` never removes its `popstate` listener.** There is no dispose
   on the `History` surface; `RouterStore.dispose()` unhooks the store's own listener but
   the window listener accumulates per store (tests, HMR).
5. **Harness gap: `createMemoryHistory` models no back/forward** — its own doc says so,
   and every existing POP test hand-rolls `replaceState` + `PopStateEvent`. The fuzz
   model's traversal dimension needs a real entry stack (`go/back/forward` emitting POP);
   filling it in the memory history serves tests and non-DOM hosts alike (RF-02).

Everything else read sound: the skip-marker design (counter + session id) is correct across
POP, the redirect depth guard and hop trail match `prepareRoute`'s contract, `setPath`'s
one-notification-per-call `finally` is deliberate, `useRouter` subscribes through uSES, and
`shouldHandleLinkClick` mirrors the Navigation API checks.

## Decisions taken 2026-07-15

- **The altitude rule is binding**, unchanged from mandala-fuzz: assertions target the
  observable contract — the rendered route (name + params), the URL bar
  (`history.location`), `router.state`/`search`/`hash`, remount discipline observed
  through effects, the redirect trail — never mechanics (`pathCounter` values, listener
  counts, internal marker strings). A test that fails under a legitimate optimization is a
  test bug.
- **Tracking is manual**, git-derived: `RF-NN:` commit subjects mark in-progress, a
  `Closes: RF-NN` trailer marks done. No status in these files.
- **SSR stays deterministic.** `prepareRoute` already has pins; no `prerender`-per-case
  fuzzing (same cost call as mandala-fuzz took).
- **Scroll restoration is fuzzed as bookkeeping, not pixels.** jsdom has no layout; the
  model asserts save/restore *keys* (which entry's position would be restored), and the
  pixel behavior stays with the existing deterministic suite.

## Decisions taken 2026-07-16 (post-RF-02 review)

The maintainer reviewed RF-01/RF-02 and decided the three product edges the foundation
filed (findings below), cut as **RF-06**:

- **A self-redirect is a loop of length 1**: report the loop and render the route's own
  component — the contract `route()` already documents for detected loops, extended to
  the 1-cycle the same-path guard was swallowing. Not: leave the stale route.
- **Dot-only param values encode**: `getPath` emits `%2E`/`%2E%2E` for a value that is
  exactly `.` or `..`, closing the codec's last round-trip hole. Values merely
  containing dots stay untouched. — **Superseded 2026-07-16**: `%2E` is normalized away
  exactly as `.` is, so this closes nothing. Re-taken as *document the limitation*, no
  behavior change — see Findings, 2026-07-16 (RF-06).
- **String redirect targets stay verbatim**, basename included by the author — no
  behavior change; the docs get the explicit line. (Auto-prepending would break every
  app already writing the full path.)

Also from the review: the RF-02 **calibration gate is passed** — the invariant altitude
(rendered route, URL bar, public getters, mount effects, the hop trail) is confirmed;
B3 fans out once RF-06 lands. And RF-01's vacuity finding propagated: RF-03.4 and
RF-05.7 are restated at the surface that owns the leaked resource (the History surface's
deterministic pin), not the store consuming it.

## Decisions taken 2026-07-16 (round-2 review)

The maintainer reviewed RF-03…06 (and SSR-12/13) and re-opened the `.`/`..` topic against
what the field does; two decisions, cut as **RF-07** and **RF-08**:

- **Relative navigation strings: the anchor resolves, the router refuses** (RF-07;
  decision corrected 2026-07-17 — the first cut recorded "coherent passthrough", every
  surface resolving like the browser, which was a misunderstanding). The router does not
  support relative strings: neither `History` grows resolution semantics, and a string
  target to `navigate`/`replace`/`redirect.to` must be an absolute path — refused
  otherwise with a framework-shaped error (RF-08's shape), which is also what closes the
  confirmed 1-cycle spelling bypass. `<Link to="..">` nonetheless works correctly,
  because resolution belongs to the platform surface that owns the reference: the
  rendered anchor's `href` IDL property is already the DOM-resolved absolute URL, so the
  intercepted click reads that back (`new URL(event.currentTarget.href)`) instead of
  re-submitting the raw prop — the router only ever sees absolute paths, and no
  resolution code enters rati. No route-hierarchy semantics (the table is flat; named
  routes and `ContextualLink` are its relative story).
- **`getPath` refuses a dot-only param value** (RF-08) — the third take on RF-02's
  finding, superseding RF-06's *document the limitation*. The platform facts stand (no
  encoding survives; every peer router silently misnavigates — React Router's
  `generatePath` doesn't encode at all, Vue Router's encoder and TanStack's
  `encodeURIComponent` both leave dots alone); what changes is the response: `getPath`
  is the single choke point, its contract is a URL that round-trips, and for this value
  no such URL exists — so it throws a framework-shaped error naming the fix, the
  RF-01 precedent. Accepted trade: a `<Link>` whose param is user data equal to `..`
  throws at render instead of silently linking to `/`.

## Items

RF-01 executes the review findings above — the codec decision, the substitution fix, the
error, the dispose — each fix with its pin, before the fuzz suite would trip over them
(the model's round-trip expectation and the engine would disagree on finding 1). RF-02
builds the foundation: the traversable memory history, the routes-table arbitrary, the
reference model (URL × entry stack → expected route), a navigate-everywhere smoke
property — and is the **calibration gate**: its review fixes the invariant altitude.
RF-06 executes the 2026-07-16 decisions on the edges RF-02 found and lifts the fuzz
exclusions they forced, so the model and the engine agree everywhere before the alphabet
grows. RF-03 adds the command alphabet and the behavioral invariants; RF-04 audits the
existing 21 suites against the pin list and adds only the missing pins — the two run as
parallel lanes (RF-04 needs only RF-02). RF-05 closes with the kill audit and
non-vacuity verification. RF-07 and RF-08 carry the round-2 decisions above (relative
strings resolved at the anchor and refused in the router; dot-only param values
refused) — hardening the review found, not new fuzz scope.

Batching, dependencies, grading: [plan.md](./plan.md).

## Kill register (executed at RF-05)

A green fuzz suite proves nothing until each invariant has caught a planted bug (mandala-fuzz's
MF-04, same reasoning). Every kill below — a bug-shaped mutation of the engine — was run red,
shrunk, and reverted; mutations never merge. Each recipe names the site, the mutation, the seed,
and the failure shape, so re-verification is a copy-paste. One command per lane:

```
FUZZ_SEED=1 vp run rati#test src/__tests__/fuzz/router.commands.fuzz.test.tsx   # the property
vp run rati#test src/__tests__/router/                                          # the 185 pins
```

**Every kill landed at the default budget** (`fuzz(25)`) **and on every seed tried** (1, 2, 3, 7,
42), where the mandala register has one kill that survives four seeds of five. The recipes pin
`FUZZ_SEED=1` regardless: an unpinned green is no evidence (MF-04's rule), and the spread is a
fact about today's alphabet rather than a promise it makes.

Both lanes were run against every kill, because "the other suite covers it" is a guess until it
isn't (RF-04's rule). What they say is the register's headline:

| Kill | The property | The 185 deterministic pins |
| --- | --- | --- |
| 1 — the matcher never refuses | red · `rendered route` | red, broadly (39 tests, 14 files) |
| 2 — a navigation drops the fragment | red · `url` | **green** |
| 3a — the same-path guard ignores `stateChanged` | red · `mount count` | red (2) |
| 3b — a navigation drops the caller's state | red · `router.state` | red (3) |
| 4 — the skip marker never goes stale | red · `mount count` | red (2, RF-04's traversal pins) |
| 5 — a redirect pushes instead of replacing | red · always on a traversal | **green** |
| 6 — a `setPath` return path stops notifying | red · `must notify subscribers` | **green** |
| 7a — `dispose()` keeps its history listener | red · the teardown tail | **green** |
| 7b — `dispose()` orphans the history it made | green (blind by construction) | red (1, RF-01's pin) |

Four kills are the fuzz suite's alone (2, 5, 6, 7a) and one is the deterministic lane's alone
(7b) — the split RF-01's finding predicted, and the reason that pin was never re-aimed at a
fuzz invariant.

1. **The matcher never refuses** — `store.ts` `getActiveRoute()`: `result = pathRe.exec(currentPath)
   ?? { groups: {} }`, so the table's first route answers every URL. `FUZZ_SEED=1` → red on case 1,
   **1 — rendered agreement**: `navigateRef → /q0/%C3%A4/a%3Fb: rendered route: expected { name:
   'root', params: {} } to deeply equal { name: 'g0', …(1) }`. Shrinks (22x) to one `navigateRef`
   off the initial `/`. The smoke property catches it too, from its own angle — `a cycle must leave
   one of its own routes: expected [ 'cyB', 'cyA' ] to include 'root'`.
2. **A navigation drops the fragment** — `store.ts` `pushOrReplace()`: `const path = (typeof to ===
   'string' ? to : this.getPath(to)).split('#')[0]!`. `FUZZ_SEED=1` → red on case 1, **2 — URL
   agreement**: `navigatePath → /zz-nothing-here#top: url: expected '/zz-nothing-here' to be
   '/zz-nothing-here#top'`. Shrinks (54x) onto the *unmatched* URL, where the rendered route agrees
   by construction and the URL assert is the only one left standing. **Not the mutation the item
   planned** — RF-05 §2 asked `pushOrReplace` to swallow the path and push the current one, which is
   red on every seed but on **1 — rendered agreement** (`navigateRef → /collide/a%20b/a%20b: rendered
   route: expected { name: 'root', … }`): a store that never moves leaves the wrong route on screen,
   and assert 1 runs first. See the finding below.
3. **State agreement is two clauses, so it takes two kills.**
   1. *The re-resolve half* — `store.ts` `setPath()`: drop `stateChanged` from the skip condition
      (`if (this._path === pathname && this.activeRoute)`). `FUZZ_SEED=1` → red on case 1, **4 —
      remount discipline**: `navigateWithState → /: mount count: expected 1 to be 2`, shrunk 45x to
      a single `navigateWithState`. It cannot reach invariant 3's own assert: `setPath` writes
      `_state` *before* the guard, so `router.state` stays right and what the kill costs is only the
      resolution — which the mount ledger is the sole witness to.
   2. *The getter half* — `store.ts` `pushOrReplace()`: `const state = skip ? { ...skip } : null`,
      dropping the caller's `{ state }` (the shape RF-03 filed against `setSearchParams`,
      generalized). `FUZZ_SEED=1` → red, **3 — state agreement**: `navigateRef → /: router.state:
      expected null to deeply equal { panelId: 'p0' }`. Shrinks 60x.
4. **The skip marker never goes stale** — `store.ts` `setPath()`: consume it without comparing the
   counter (`if (typeof state === 'object' && state && 'skip' in state) return`). `FUZZ_SEED=1` →
   red on case 1, **4 — remount discipline**: `go(-1): mount count: expected 1 to be 2` (seeds 2, 7,
   42 land on `back`). Both lanes bite, and differently: RF-04's pins name the stranded route
   outright (`expected 'home' to be 'user'`), while the property shrinks past that to the sharper
   shape — a POP onto a stale marker whose URL resolves to the route *already mounted*, where every
   rendered value agrees and the remount that didn't happen is the only evidence. Which bites
   first, as the item asked: the pin, by a wide margin — it is unconditional and names the symptom,
   where the property has to generate the interleaving (it did, on all five seeds).
5. **A redirect pushes instead of replacing** — `store.ts` `setPath()`: `this.navigate(targetPath)`
   in place of `this.replace(targetPath)`. `FUZZ_SEED=1` → red on case 1, **5 — redirect
   discipline**, shrunk 66x to `toRedirectRoute → /r0` then `back`: `back: redirectHops: expected
   [ { from: '/r0', to: '/', …(1) } ] to deeply equal []` — going back re-enters the redirect it
   should have stepped over. Seeds 2, 3, 42 fail on `back: rendered route`, seed 7 on `go(-1): url`:
   the verdict is always a *traversal*, never the navigation that grew the stack. Which is why the
   forward-only smoke property stays green, and why all 185 pins do — including RF-04's fresh
   redirect-cap ones, since none of them steps back afterwards.
6. **A `setPath` return path stops notifying** — `store.ts` `setPath()`: `let silent = false`, set
   at the same-path early return, and `finally { if (!silent) this.emitChange(); }` — the deliberate
   one-notification-per-call `finally`, undone for the return that "resolved nothing". `FUZZ_SEED=1`
   → red on case 2, **6 — notification coherence**: `setSearchParams:replace ?: a resolution must
   notify subscribers: expected 1 to be greater than 1`, shrunk 20x. See the finding below: the
   shrink lands on the corner where *nothing observable changed*, and it is the consumer clause —
   not this one — that catches the same kill where an app would see it.
7. **Teardown, two disposes, one per lane.**
   1. *The store's own listener* — `store.ts` `dispose()`: drop `this.unlistenHistory()`.
      `FUZZ_SEED=1` → red on case 1 (shrunk 23x), on RF-03.4's tail: `after dispose: nothing may
      remount: expected 2 to be 1`. All 185 pins stay green — a disposed store is inert to *its own*
      history only through that call, and nothing hand-written drives the injected history past
      dispose.
   2. *The history it created* — `store.ts` `dispose()`: drop `this.history.dispose?.()`. The fuzz
      suite is green and stays green by construction (the harness injects its history, so this line
      never runs); exactly one pin goes red, the one RF-01 wrote at the surface that owns the
      resource — `webRouterCore.test.ts > RouterStore.dispose > dispose() detaches the history the
      store created from the DOM`.

**The counters gate.** Removing the traversal verbs (`Back`, `Forward`, `Go`) from
`routerCommandsArb` leaves every invariant green — a run that never walks the entry stack is a
vacuous pass — and fails exactly one assert, the first counter: `never exercised: a traversal ran:
expected 0 to be greater than 0`. Nothing else moves, which is the gate doing its job.

## Findings

(Appended as dated notes as items execute; a real router bug is a finding to surface, not
to silently fix.)

### 2026-07-16 (RF-01) — the four fixes landed; one proposed pin was vacuous

- **Finding 4's proposed pin does not bite, and the leak has no store-level symptom.** The
  item asked for "two sequential stores in one jsdom window; disposing the first leaves
  exactly the second responding to popstate". Written and run against the unfixed engine, it
  **passes** — `dispose()` already unhooks the store's own listener from its history, so a
  disposed store is inert either way. The leaked `popstate` subscription is real, but it is a
  memory leak with no behavioral shadow at the store altitude: the only store-visible
  difference would be counting `window` listeners, which the altitude rule forbids. What does
  bite is a pin at the *History* surface's own contract (public API, so a legitimate
  altitude): register a listener on the store's created history **after** `dispose()`, then
  dispatch popstate — unfixed, the window subscription still fans out to it. The ordering is
  load-bearing and is commented at the test; registering before dispose passes either way.
  Generalizes for RF-05: a leak-shaped finding needs a pin at the surface that owns the
  resource, not at the consumer that outlives it.
- **The codec change moved no pinned URL string.** The item expected a sweep ("existing
  suites for pinned URL strings the change moves"). There was nothing to review: every param
  value pinned across the 21 suites and both examples is alphanumeric (`42`, `abc`, `7`,
  `Unicorn`), and `encodeURIComponent` is the identity on all of them. The full suite went
  green on the fix with no test edited. jnana's base64url shape is likewise untouched by
  construction — its alphabet (`A-Za-z0-9-_`) is entirely unreserved — and now has a pin
  saying so.
- **Out of scope, pre-existing: a malformed escape 500s the *dev* server.** Driving the
  gallery to check the new fallback end-to-end: `GET /products/%zz` answers **404 in
  production** — `staticPath` already guards its own decode, the router now warns and hands
  `%zz` through, and the example's load reports not-available — but the **dev** server
  answers 500 `URI malformed`. `assemble` (`vite/ratiSsr.ts`) passes the raw request URL to
  `server.transformIndexHtml(url, …)`, and vite-plus-core's `getHtmlFilename` runs
  `decodeURIComponent` on it and throws, after the app has already rendered its 404. So the
  router is right and the layer above it drops the result. Confirmed pre-existing (stash
  RF-01, same 500) and it lives in `vite/`, not `router/` — left for its own item rather
  than folded in here. Worth knowing that dev and production disagree on malformed URLs.
- **Finding 2's corruption is key-order dependent.** `/x/:idx/:id` only breaks when the
  shorter name is substituted first, i.e. when the caller's object happens to list `id`
  before `idx` (`Object.entries` is insertion-ordered). The README's `/x/7x/:id` example is
  exactly that case. So the bug was live but fired on caller-side key order — worth knowing
  for RF-03's arbitrary, which should not assume a param table shuffles independently of the
  path.

### 2026-07-16 (RF-02) — three product edges the foundation found, and two vacuous tests

Product findings, none fixed (each is a decision, not a slip). All three were confirmed
against the engine by hand; the fuzz arbitrary steps around them deliberately, with the
reason written at the exclusion, so the model isn't quietly made to bless them:

- **A route that redirects to itself leaves the *previous* page rendered at the new URL.**
  `route('/self', …, { redirect: { to: '/self' } })`, navigated to from `/home`: the URL bar
  and `router.path` both read `/self`, a hop is recorded — and `activeRoute` is still `home`.
  No loop is reported and the depth guard never fires, because `setPath` writes `this._path`
  *before* following the redirect, so the nested `setPath` sees its own path unchanged and
  takes the same-path early return. A 2-cycle recurses to the cap normally; only the 1-cycle
  short-circuits. This is the one shape that produces a genuinely stale route — the thing
  RF-02's catch-all check exists to look for — so it is worth a decision rather than a
  shrug. The arbitrary excludes self-targets; RF-03 should not add them until the semantics
  are chosen (render the redirect route? report the loop? treat it as a cycle of length 1?).
- **A bare string redirect target escapes the basename.** With `basename: '/admin'`,
  `route('/a', …, { redirect: { to: '/b' } })` lands on URL `/b`, not `/admin/b` — the app
  leaves its own mount point. It still *renders* `b`, because `stripBasename` hands a
  pathname that isn't under the basename to the matcher as-is. Consistent with the docs read
  literally (an object target "resolves through the route table", a string one "is used
  verbatim", and `getPath` says the basename is the caller's business for strings) — but the
  fall-through it relies on is commented as being there for the 404 catch-all, and here it
  quietly rescues a URL that has already lost the prefix. The arbitrary writes string targets
  with the basename included (what a correct app writes), so the model states the working
  shape rather than the sharp one.
- **A param value of `.` or `..` silently navigates somewhere else.** `getPath({ name:
  'user', id: '..' })` builds `/users/..` — `encodeURIComponent` does not touch dots — and
  the URL parser then normalizes the segment away, so the entry lands on `/` and the root
  route renders. `.` behaves the same (`/users/.` → `/users/`). This is the codec's one
  remaining round-trip hole after RF-01: everything else in the hostile pool (spaces,
  slashes, percent, `?`, `#`, non-ASCII) survives. Closing it means encoding dot-only
  segments (`%2E%2E`) in `getPath`, which is a codec decision of the same class as RF-01's.

Harness findings, generalizing for RF-05:

- **Two proposed pins were vacuous, and the kill is what said so.** The memory-history
  "push drops the forward tail" pin first asserted through `forward()` — and it passes
  against an untruncated push, because appending still leaves the index at the tip, so
  `forward` is a no-op either way and the orphaned entry hides *behind* the new one. Only a
  `back()` step reaches it. Restated for the register: for a bug that makes a container hold
  *too much*, assert from the side the surplus is on.
- **Non-vacuity is a property of the arbitrary's *joint* distribution, not of its parts.**
  Both starved paths in this item came from independent draws that were fine alone: drawing
  a navigation's search/hash independently of its form demoted ~17 in 18 navigations to a
  literal URL (a reference is the only form that calls `getPath`, and it can't carry a
  query), so the prefix-collision kill needed a 20x budget to land; and independent targets
  almost never repeated a URL, leaving the *skipped* navigation at ~1% of steps. Every
  invariant was green throughout. The counters are now asserted in the property, and the
  fix — pair the two draws, repeat whole destinations — moved that kill from 0/1 seeds to
  8/8 at the default budget.

### 2026-07-16 (RF-06) — one decision could not be carried out, and the 1-cycle was two bugs

- **`%2E` is not an escape from dot-segment normalization, so the dot decision was re-taken
  mid-item.** RF-06 §2 asked `getPath` to emit `%2E`/`%2E%2E` for a value that is exactly
  `.` or `..`, on the reading that "the decode side already round-trips them". The decode
  side does; the URL parser does not. A dot-only segment is resolved away in *every*
  spelling — `..`, `%2E%2E`, `%2e%2e`, `.%2E` — because URLs read `%2E` as a dot on
  purpose: it is exactly what stops percent-encoding from smuggling a traversal past a path
  check. Driven against the real store, `/users/%2E%2E` lands on `/` just as `/users/..`
  does, and both histories agree (memory parses via `new URL`, browser via `pushState`).
  The one spelling that survives is double-encoding (`%252E%252E`), which decodes to
  `%2E%2E`, not `..`; closing *that* gap needs a decode-side special case, and it collides —
  `'..'` and the literal `'%2E%2E'` both encode to `%252E%252E`, so it would trade the hole
  for a worse one, on a value that round-trips correctly today. There is no URL that carries
  a dot-only param value. Decision re-taken by the maintainer: **document the limitation**,
  no behavior change. reference.md §Routing states it and points at the query string;
  `getPath`'s comment names the `%2E` trap so the next reader doesn't re-file it as a bug
  (it also stopped claiming the round-trip holds "whatever characters it contains", which
  was false). The value pool keeps dot-only values out — now against documented contract
  rather than an open finding — and gains `a.b`/`..x`, the live half: the boundary is "the
  whole segment is dots", not "dots occur". Generalizes: a "close the last hole" decision
  taken over a codec is worth driving against the platform before it is committed to, since
  the platform may already have taken a position for its own reasons.
- **The self-redirect was two behaviors under one description, and only one of them was the
  stale route.** RF-02 filed the 1-cycle as "leaves the *previous* page rendered at the new
  URL" — which is what a *navigation into* it does. A router constructed straight at the
  self-route never had that symptom: the same-path early return needs a resolved
  `activeRoute` to skip past, and a fresh store has none, so following recursed to the depth
  cap and reported the loop correctly, in ten identical hops. The two entries into `setPath`
  disagreed, and the filed description only covered one. The fix unifies them at one hop, so
  `prepareRoute` reports the same 30x it always did (`redirectFromHops` reads the last hop's
  target, which is `/self` either way) while the client stops going stale. It also showed up
  in the kill: with the fix reverted, the fuzz property shrank to the *fresh-router* case and
  failed on the hop trail, not on the rendered route. Worth knowing for RF-03: constructing
  at the URL under test and navigating to it are not interchangeable paths through `setPath`,
  and a property that only ever does the former would have missed the bug RF-02 filed.

### 2026-07-16 (RF-03) — the shallow marker sits in the app's own pocket, and a query rewrite empties it

Product findings, neither fixed (each is a decision, not a slip). Both were confirmed by
hand against the real store before being filed, and the model states them rather than
stepping around them — the alphabet cannot avoid either without giving up the shallow half
of its scope.

- **`keepCurrentRoute`'s suppression marker lives *inside* the app's per-entry state, where
  it is both visible and load-bearing.** `pushOrReplace` merges its marker into the caller's
  object (`{ ...skip, ...options.state }`), so after
  `navigate(url, { keepCurrentRoute: true, state: { panelId: 'p0' } })` the public getter
  reads `{ skip: '1/2dee0231-…', panelId: 'p0' }` — and with no state passed at all it reads
  `{ skip: '…' }` rather than `null`. Both contradict what `state` documents itself as ("user
  state attached to the current history entry … or `null`"; reference.md §Routing says the
  same). The existing pin reads *through* it (`webRouterCore.test.ts` asserts
  `(router.state as { panelId?: string }).panelId`), which is why nothing caught it.
  The half that makes it more than cosmetic: `setPath` decides whether to re-resolve by
  comparing whole `state` objects, so the marker is what makes a shallow entry compare
  unequal to every other one. Two entries agreeing on URL *and* on the user's own state
  still re-resolve when a traversal steps between them — driven by hand, two shallow
  `navigate`s to `/users/1` with `{ panelId: 'p0' }` then `back()` remounts, while the same
  shape without `keepCurrentRoute` does not. That re-resolve is *wanted* (a shallow entry's
  mounted route is deliberately not the one the URL names, so resolving it on any later
  arrival is right, and store.ts's own comment says a POP must find the marker stale) —
  only the way it is achieved is the finding. So the constraint on any fix: getting the
  marker out of the user's object must keep the per-entry distinctness it currently supplies,
  or the shallow design loses the re-resolve it depends on. The property holds the user's
  half to equality and lets the marker through by name, so a fix that moves it turns the
  `stateHasMark` branch red and says so.
- **`setSearchParams` drops the entry's per-entry state, and the drop re-resolves the
  route.** It builds its URL and calls `history.push`/`replace` with no state at all, so an
  app that tweaks a filter loses whatever `state` the entry carried — `router.state` reads
  `null` afterwards. Because the store re-resolves on a state change, that silently remounts
  the route on the same URL: driven by hand, `navigate('/users/1', { state: { panelId: 'p0' }})`
  then `setSearchParams({ tab: 'a' })` remounts, and a *second* `setSearchParams` does not
  (the state is already `null`, so nothing changed). A query rewrite costing the app its
  state and one remount, but only the first time, is a surprising shape to leave undocumented
  whichever way it is decided. The docs promise nothing either way today.

Harness findings, generalizing for RF-05:

- **A restatement of *state* must not assert a *command*-scoped fact.** Both properties close
  with a catch-all that re-checks the end state, and it borrowed the per-command assertion
  wholesale — including "the refused loop was reported", which belongs to the resolution that
  raised it. A command that resolves nothing (a traversal with nowhere to go) leaves the
  model still describing the last command that did, while the console log has moved on, and
  the catch-all fails on that disagreement rather than on anything the router got wrong. The
  fuzz run found it by shrinking to `[initial URL is the cycle, go(0)]` — two commands, one
  of them a no-op. The assertions are split now (`assertRenderedState` vs `assertStep`).
- **The deep budget the effort trusts is the one that trips the test timeout.** `scripts/ci.ts`
  documents `FUZZ_RUNS=2000` as the way to deepen, and vitest's default 5s per-test bound is
  blind to `numRuns` — so the command property crossed it and reported "Tests 1 failed" with
  no counterexample and nothing wrong with the router. It cost a seed hunt to tell apart from
  a real 1-in-20 flake (28,000 property runs across pinned seeds, all green, was what said
  so). `fuzzTimeout()` now scales the bound with the budget. Worth knowing generally: a
  failure mode that only fires on the *deep* runs is one that fires on exactly the runs meant
  to be trustworthy, and it wears a property failure's clothes.
- **Five kills executed against the encoding, all caught at the default budget** — the register
  is RF-05's, but an invariant that could not catch its own kill is mis-encoded, so these were
  run rather than guessed: `dispose()` dropping `unlistenHistory()` (the teardown tail:
  "nothing may remount"), the skip marker never going stale (`back: rendered route` — the kept
  route stranded), `shallowEqualState` degraded to `===` (`mount count`), `go` clamping to the
  ends instead of refusing (`go(1): nothing to notify`), and the same-path early return
  ignoring `stateChanged` (`rendered route`). Each landed at `fuzz(25)` with a message naming
  the right thing; none needed the deep budget.

### 2026-07-16 (RF-04) — the audit: three of the five named kills already bit, and one standing pin was vacuous

The item's own framing held — the risk here was duplication, not absence. Every verdict below
was reached by *executing* the kill against the existing suite rather than by reading it: an
"already covered" claim is exactly as much of a guess as an unexecuted kill note, and it is the
more expensive one to get wrong (it ends with a pin not written).

| Pin | Existed? | Added |
| --- | --- | --- |
| 1 skip-marker staleness across POP | no — `webRouterCore` arms the marker (`:185`) and never steps back; the suite has no traversal at all | `webRouterTraversal.test.ts` |
| 2 cross-session marker | no — `sessionId` appears nowhere in the test tree, and the fuzz lane cannot reach it | `webRouterTraversal.test.ts` |
| 3 redirect depth/loop | the named kill already bites (`redirect.test.tsx:92`); RF-06 pinned the 1-cycle exactly | cap depth + trail content + the render, folded into the existing cap test |
| 4 hydrated-state drift | **yes** — `webRouterHydration.test.tsx:56` catches the named kill | nothing |
| 5 state-only navigation | the named kill already bites (`webRouterCore.test.ts:242`); both halves pinned via PUSH | the traversal half only |
| 6 basename edges | (a) `:70`, (c) `:28`, (d) `:52` all bite | the outside-basename fall-through |
| 7 scroll-restoration keys | no — the standing pin is vacuous (below) | three POP branches, over a memory history |
| 8 `preloadRoute` | **yes** — all four clauses bite | nothing |

- **`saves position when leaving an entry, restores on POP` never looked up a saved position,
  and deleting the entire restore branch left it green.** It forged the POP by dispatching a
  bare `popstate`, which changes neither the URL nor `window.history.state` — so `readLocation`
  handed back the key of the entry the test had just pushed *to*, `positions.get` missed, and
  the restore fell through to `scrollTo(0, 0)`. Its assertion (scrollTo was called *at all*,
  more times than before) cannot tell that apart from a restore, and the test says so in its own
  comment: "For a minimal smoke test…". It was written before `createMemoryHistory` had an entry
  stack (README finding 5), which is the whole reason it forged the event — so this is RF-02's
  gap cashing out one item later, in a test that read as coverage for a year. The replacements
  traverse a real stack, where the entry hands back its own key. Generalizes for RF-05: a pin
  whose subject is *key bookkeeping* must be written against a history that has keys — forging
  the event forges the key too, and the assertion left standing was the one weak enough to
  survive it.
- **Three of the five named kills were already caught, so three planned pins were not written.**
  Pins 3, 4 and 5 each name a kill (`redirectDepth === 0` reset dropped; `seedFromHydratedState`
  returning early; `shallowEqualState` degraded to `===`), and all three go red against the
  suite as it stands. What was missing in 3 and 5 was never the kill but a *clause*: the cap's
  depth and the render for 3, the traversal for 5. Pin 4 was missing nothing. Worth knowing for
  a future audit item: a pin list written from the source reads gaps that the suite may already
  cover from the other side, and only the kill says which.
- **Pin 2's counter coincides by construction, which is the hazard itself.** The restored-tab
  shape needs the marker's counter half to *match* or the session id is never what's doing the
  work — and it matches for free: the second store replays the same navigation count over the
  same stack, so it arrives holding exactly the counter the first store stamped. That is not a
  test convenience; it is why `sessionId` exists (a reload restarts `pathCounter` at 0 against
  markers that persisted). The pin builds it by driving two real stores over one history rather
  than hand-writing a marker string, so nothing in it spells the mechanics out.
- **The render clause earns its place, and a second kill is what proved it.** "Renders the last
  route's component" looks redundant next to the store-level `activeRoute?.name` the cap test
  already asserted. It is not: a `Router` that declines to render a route still carrying a
  `redirect` declaration — a plausible optimization, since such a route is normally transient —
  leaves the store's answer correct and the screen blank, and only the DOM assertion goes red.
  Generalizes: when a clause looks redundant, the question is not whether *a* kill catches it
  but whether one exists that catches it *alone*.
- **A failing test poisoned the next one, through `getElementById`.** The new anchor pin removed
  its target inline, so a red run left `div#section` in the DOM and the *existing* anchor test —
  which builds its own `#section` — then asserted against the first match, someone else's
  element. Three of the four scroll kills reported two failures each until the teardown moved to
  `afterEach`. Harmless while green, which is when nobody looks: it inflates every future kill
  run in the file into a false blast radius, and RF-05 reads those.
- **No product findings.** Every added pin went green against the engine as it stands; nothing
  here uncovered a router bug, which after RF-01/02/06 is the expected result rather than a
  surprising one.

### 2026-07-16 (RF-05) — the kills the wrong family caught, and the four the pins can't see

The register above is the artifact; these are the things executing it taught that reading it
wouldn't. No kill survived, so no invariant was mis-encoded and no suite change was forced — and
no product findings: the engine went back to exactly where it started.

- **Two of the seven planned kills were caught by a *different* family's assert, and that is the
  register earning its keep rather than a slip in it.** The item's kill for *URL agreement* (push
  the current URL) and its kill for *state agreement* (drop `stateChanged`) both go red on every
  seed — and neither one reaches the assert it was written for. A store that pushes nowhere leaves
  the wrong route on screen, and `rendered route` runs before `url`; a guard that ignores
  `stateChanged` still writes `_state` before it returns, so `router.state` is right and only the
  missing remount is wrong. Both families were re-killed with mutations that leave exactly one
  assert standing (the fragment dropped; the caller's state dropped), and both then bit on their
  own. Generalizes, and sharpens RF-04's version of it: a kill proves the family it lands on, not
  the family it was aimed at — so the mutation has to be chosen against the *assertion order*, and
  a register that only records "red" records less than it thinks.
- **Four kills are invisible to all 185 deterministic pins, and one of them was a surprise.**
  Following a redirect with `push` (2), silencing a `setPath` return (6) and leaking the store's
  history listener (7a) were expected to be the fuzz lane's own — they need a traversal, a
  subscriber, or a teardown that hand-written tests don't reach. **Dropping the fragment from every
  navigation** was not: 24 files, one of them named `webRouterHashAnchor.test.ts`, and the suite
  stays green, because the hash pins drive the *history* directly and nothing pins the hash
  surviving a `navigate`. That gap sat under a suite that reads as covering it. Worth knowing for a
  future audit: the strongest evidence a lane adds something is a kill the other lane cannot see,
  and it turns up in the places whose names suggest otherwise.
- **The emit-half of notification coherence is proved only at its degenerate corner.** Kill 6
  shrinks to `setSearchParams:replace ?` — an empty rewrite on a query-less URL, where *nothing
  observable changed* and the assert is pinning the store's "one notification per `setPath`"
  contract rather than anything an app could see. Blinding `assertNotified` and re-running the same
  kill shows `assertConsumerFresh` catching it on all five seeds, on the case that matters
  (`setSearchParams:replace ?tab=a: what a subscribed consumer last rendered`) — so the family is
  proved twice, by two asserts that each cover what the other doesn't. The lesson is about
  shrinking, not about this invariant: a shrinker walks to the *weakest* instance of an assert, so
  a counterexample is the worst evidence in the run for what the invariant is worth.
- **The kills are much broader here than in the mandala register**, where kill 3 survives four
  seeds of five and the recipes lean on their pins. Every router kill is red at `fuzz(25)` on every
  seed tried. Not a virtue of the invariants: the alphabet is hand-weighted toward traversal and
  the state seam and every generated table carries a redirect pair, so a 14-command sequence hits
  the machinery many times over. Read it as calibration — the budget has headroom, and a future
  invariant that needs a pinned seed is worth a second look rather than a shrug.

### 2026-07-16 (round-2 review) — the fix that compared a spelling, and the model that mirrors one history

The review re-verified RF-03…06 against the code (independent agents, claims re-executed
by hand) and re-opened the `.`/`..` topic; the decisions are above, the findings here:

- **RF-06's 1-cycle check compares the target's *spelling*, not its resolution — a
  relative self-target walks straight past it.** Confirmed against the real store:
  `redirect: { to: 'self' }` at `/self`, entered from `/home`, leaves `activeRoute` on
  `home` at URL `/self` with one hop recorded and **no loop reported** — the exact
  stale-route shape RF-06 fixed, back through a spelling. The comparison sees
  `'self' !== '/self'`, follows, the platform resolves the replace back to `/self`, and
  the nested `setPath` takes the same-path early return. RF-07 §3 owns the fix — by
  refusal, not resolution: a relative redirect target is out of contract and errors
  before it can spell its way past the comparison. Generalizes: a guard that compares
  what the *caller wrote* against what the *platform resolves* must either resolve
  first or refuse the spellings it won't resolve — anything in between is a bypass.
- **The two histories disagree on every relative navigation string.** The browser
  resolves against the current URL (`push('sub')` at `/a/b/c` → `/a/b/sub`); the memory
  history parses against a fixed placeholder origin (`/sub`) — confirmed by hand. So
  SSR (a relative redirect target's `Location`), tests, and the fuzz model all run on
  semantics the browser doesn't have. The model is only faithful because the arbitrary
  draws absolute URLs exclusively; RF-07 resolves the tension the other way — the
  router refuses relative strings outright, so the divergence stays as the recorded
  reason the input class is out of contract, and the histories stay resolution-free.
- **The fresh-construction self-redirect had no deterministic pin** (agent finding): the
  1-cycle was hand-pinned only on the navigate-into path, while the fresh path — the one
  RF-06's own kill shrank to — was property-only. Pinned in-round
  (`redirect.test.tsx`, "constructed straight at a self-redirect"); the deterministic
  lane is 186 pins now (the register's 185 is RF-05's execution record and stays as
  written).
- **A kill comment predicted the wrong stranded route** (agent finding, re-traced by
  hand): `webRouterTraversal.test.ts`'s marker-staleness kill note said the assertion
  would read `'dashboard'` (the kept route); it reads `'home'` — the route mounted when
  the POP fires. The pin bites either way; the comment is corrected. A sharpening of
  RF-05's lesson: what a kill strands is decided by the state at the *traversal*, not by
  the entry that armed the marker.

### 2026-07-17 (from SSR-14/15's gate run) — the coverage guard is itself unreachable ~14% of the time

- **`router.commands.fuzz.test.tsx`'s "never exercised" guard fails intermittently at the
  default budget, and its comment says it cannot.** Surfaced as a `yarn ci` test-stage
  failure during an unrelated SSR item (`never exercised: a traversal landed on a stale
  shallow entry`), on a tree that touches no router code. Measured rather than assumed:
  50 runs of the suite at the default `fuzz(25)`, half on a clean checkout, failed 7
  times — ~14% per run, on two of the sixteen listed shapes (`a traversal landed on a
  stale shallow entry`, `a traversal stepped between two same-URL entries differing in
  state`). Both need a multi-step conspiracy the alphabet reaches only sometimes: a
  shallow entry armed, *then* navigated away from, *then* traversed back onto.
  `:117` states the opposite — "Every one of these is reachable at the default budget" —
  which is what makes this worth a note rather than a shrug: the guard exists to catch a
  harness that stopped generating a shape, and it currently cries wolf often enough that
  the honest reading of a red one is "re-run it". That is the failure mode it was built
  to prevent, inverted. The deep stage (`FUZZ_RUNS=500`) is not affected — this is the
  day-to-day `test` stage only.
- Not fixed here (out of an SSR item's scope, and the fix is a judgment call): the shapes
  are real and reachable, so the options are a per-shape floor rather than one budget for
  all sixteen, a generator weighted toward the conspiracy, or moving the coverage guard
  off the tiny budget onto the deep stage that can actually afford it. Filed as RF-09
  (issues/RF-09-coverage-guard-flake.md, plan.md B6) with the options weighed there; it
  re-fired once more during the 2026-07-17 review round, again on a tree touching no
  traversal code.
- **Resolved (RF-09):** the recommended option landed — the sixteen-shape assertion now
  fires only at the deep budget (`atDeepFuzzBudget()` in `arbitraries.ts`, the same
  `FUZZ_RUNS` env `fuzz()` reads), which the `fuzz` stage always runs at 500 and where
  every shape is reliably reached; the counters still accumulate at every budget, so a
  deep run still fails loudly on a starved shape. The default `test` stage counts but no
  longer asserts, so it stops crying wolf, and the `:117` comment now states a true claim.

### 2026-07-17 (post-close review round) — RF-07's guard admitted authority-carrying spellings

- **`assertAbsolutePathTarget` checked only `startsWith('/')`, and `//host` starts with
  `/`.** The URL parser reads a second authority introducer as another origin — `//host`,
  and every spelling it normalizes into it: `/\host` (backslash becomes slash in special
  schemes), `///host`, and tab/newline-smuggled variants (`/\t/host` — the parser strips
  those characters before it looks; all five confirmed by hand in Node). The class is
  exactly what RF-07 refuses on — the browser's `pushState` throws it cross-origin while
  the memory history quietly lands on the parsed pathname — and it is security-relevant
  besides: a redirect target rides `prepareRoute` verbatim into the server's `Location`
  header, and a function redirect composed from a decoded param (params carry `/` via
  `%2F`) makes `Location: //evil.com` reachable from a request URL — an open redirect.
  Found independently by a review agent and by hand; the reachability chain
  (`decodeParams` → `to(params)` → guard → hops → `redirectFromHops` → `Location`)
  re-traced in code before fixing.
- Closed at the same choke point, in-round: the guard now also parses the target against
  the memory history's placeholder origin and refuses anything that resolves off it —
  the character-prefix alternative was rejected because the whitespace spellings escape
  it. Four deterministic pins (`webRouterCore.test.ts`) plus the open-redirect repro
  (`redirect.test.tsx`, `%2F%2Fevil.com` through a function redirect); kill executed once
  — origin check dropped, exactly those five red, the nine not-absolute pins green.
- Also from the same round, pinned without a code change: an empty `href` on `<Link>` is
  now *active* at a search-less current URL (`new URL('', base)` returns the base — the
  resolution-decides rule, deliberately), and `isHrefActive`'s comment now names the
  `<base href>` element as the one base the click and the active check would not share
  (rati doesn't support one).

## Per-item conventions

rati works in atomic commits on the current branch (its `CLAUDE.md`); prefix subjects with
the item id (`RF-01: …`), put `Closes: RF-01` in the finishing commit's trailer block, keep
`yarn ci` green (`scripts/ci.ts` — the whole gate, deep fuzz budget included), and push.
Findings that are out of an item's scope get a dated note appended here, not a silent fix.
