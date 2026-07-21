# scope-and-island — resolution control and advanced loading states

Status: planned 2026-07-19. Per-item status derives from rati git (`git log --grep 'SI-'`,
`Closes:` trailers) — never from this file; conventions below.

Executes parts 1 and 2 of
[scope-and-island-directions.md](docs/research/scope-and-island-directions.md) — the scope/
resolution half (abort signals) and the island loading-state half (`loadingDelayMs`,
`keepStale` + the status surface, retry policy, per-island `ssr: false`, SSR-error
dehydration). Part 3 (`ResourceContainer` migrating into core) stays in research — it waits
on the `.extend()` / layout-scope work and is not cut here.

The research doc holds the design detail (sketches, trade-offs, the interplay notes); each
item record points at its section rather than restating it. Where a record and the research
doc disagree, the record wins — it is the executed decision.

## Decisions taken 2026-07-19 (at cut)

- **All six directions are cut**, including the two the research doc marked wait-for-need
  (retry policy, SSR-error options) — maintainer's call at the cut: the effort prepares the
  island surface as a whole rather than leaving two known gaps for consumers to hit.
- **The status surface extends `useScopeControls`** — no new hook. `phase` / `isStale` (and
  the error-slot `retry`, folded in) land on the controls object `mandala/controls.ts`
  already returns. The research doc's `useIslandStatus` sketch is dropped; plain-naming rule:
  no second public name for the same channel.
- **`keepStale` is Option A** (engine-owned kept props + status flag), not Option B (React
  transitions) — determinism per island, and source-backed pending wouldn't suspend anyway.
- **`SI-03` precedes `SI-02`.** The research doc presents `loadingDelayMs` first, but its
  re-resolve behavior ("previous content until the delay elapses") needs the same
  kept-committed-bucket mechanism `keepStale` is built on. The engine change lands once, in
  SI-03; SI-02 rides it.
- **Cut assuming the stores-container work has landed** (table-blind router surface,
  `StoresProvider` / `createStoresHook`). If an item finds the shipped surface differs from
  [stores-container-implementation.md](docs/research/stores-container-implementation.md),
  reconcile against what actually shipped and note it here.

## Items

SI-01 (abort signals) and SI-04 (`ssr: false`) are independent of everything and of each
other — they run first, in parallel. SI-03 is the effort's heart and its calibration gate:
it teaches the mandala to keep the last committed props across a re-resolve and extends
`useScopeControls` with the status surface; its semantics review gates the rest. SI-02
(`loadingDelayMs`) builds on the kept-bucket mechanism and pins the composed contract
("the loading slot appears only for a slow first load"). SI-05 (retry policy) and SI-06
(SSR-error dehydration) close the effort as a serial lane — both touch `boundary.tsx`, and
SI-05 reads SI-03's phase surface (an automatic retry must be visible as a phase, not a
frozen error slot).

- [SI-01 — abort signals for data loads](issues/SI-01-abort-signals.md)
- [SI-02 — `loadingDelayMs`](issues/SI-02-loading-delay.md)
- [SI-03 — `keepStale` + the status surface on `useScopeControls`](issues/SI-03-keep-stale-status.md)
- [SI-04 — per-island `ssr: false`](issues/SI-04-ssr-opt-out.md)
- [SI-05 — automatic retry policy](issues/SI-05-retry-policy.md)
- [SI-06 — SSR error dehydration (`ssrErrors`)](issues/SI-06-ssr-error-dehydration.md)

Batching, dependencies, grading: [plan.md](plan.md).

## Findings

(Appended as dated notes as items execute; a real engine bug found mid-item is a finding to
surface, not to silently fix.)

### 2026-07-19 — SI-01 (abort signals) shipped + decisions

Two commits: the engine + type change, then the pins. `yarn ci` green; 65 files / 581 tests.

- **`LoadContext`, not `LoadOptions`.** `DataLoadOptions` (the `data(fn, { equals })`
  config) already owns "options" one screen away in the same file; two neighbouring types
  called options would be a naming trap for exactly the readers this argument is new to.
  The bag is the load's *run* seen from inside — TanStack's `QueryFunctionContext` is the
  same call. Exported from the main barrel so a load extracted into its own function can
  name its second parameter.
- **The signal belongs to the bucket, so `refresh(key)` shares it** — a selective refresh
  replaces a load *inside* a live run, and cancelling there would kill data the island
  still intends to show. The consequence the record's discard list doesn't cover: a
  `refresh(key)` that supersedes its *own* in-flight re-fetch (the double-click) leaves the
  predecessor running, as today. Per-key cancellation needs a controller per cell, with the
  teardown discipline that implies — not cut here; worth its own item if a consumer hits it.
- **Class loads get no context.** The record's shape is `(props, { signal })` for function
  loads; a class load constructs a value, and what it starts it owns (its `[Symbol.dispose]`
  is the teardown seam). Adding a second constructor parameter would also widen
  `{ new (resolved): any }` in `LoadDefinition` for no case anyone has.
- **The swallow is load-bearing, and only for producer-backed promises.** A level suspends
  on the first pending `use()`, so a *sibling* promise built in the same pass never reaches
  `use()` and carries no handler at all — that is the one that surfaces as an unhandled
  rejection when the run is aborted (verified by removing the line: `AbortError` straight to
  Node's `unhandledRejection`). Static promise entries are deliberately left alone: they
  never received the signal, and marking a shared module-level promise as handled forever
  isn't the engine's call.
- **`refreshFailed` had to learn the difference between cancelled and failed** — otherwise
  unmounting with a `refresh(key)` in flight logs `[rati] refresh('x') failed — keeping the
  previous value.` at every teardown, for a load nobody is keeping anything for.
- **No abort reason argument**, so `signal.reason` stays the standard `AbortError`
  `DOMException` — the `error.name === 'AbortError'` check every fetch wrapper already has
  keeps working. A rati-flavored reason would read better in a debugger and break that.
- **The SSR request-abort seam (the record asked): real, but not this item's.** React's half
  is already there — `prerender` takes a `signal`, and `rati/testing`'s settle watchdog
  drives it (DX-08). The missing half is the loads': nothing connects a request to the
  per-bucket controllers, so it wants a run-level parent signal threaded on `Shared`
  (`renderApp` → `renderToHtml` → the resolver) and composed per bucket. That is a
  server-side item — `renderApp` doesn't take a request signal at all today — and it lands
  with one, not here.
- **The examples gained nothing on purpose.** The gallery's job is foregrounding
  server/client behavior; a signal that never fires server-side has nothing to show there,
  and the guide's `fetch` example is the whole story on the client.

### 2026-07-20 — SI-04 (`ssr: false`) shipped + decisions

Two commits: the engine + threading + pins, then the gallery page; docs alongside.
`yarn ci` green; 66 files / 589 tests.

- **The gate is `getServerSnapshot`, not the collector.** The record framed the condition
  as "`false` and a collector is present (server render)" — the collector being the
  mandala's only way to know where it is. `useSyncExternalStore`'s third argument is a
  better one: React reads it on the server *and* through the client's hydration pass, which
  is exactly the pair of renders that must show the slot. The consequence is a small
  widening — the option now means the same thing under a bare `prerender` with no
  `HydrationProvider` — which reads as the more honest behavior for an option named `ssr`.
- **What the hook really buys is the hydration pass, not the server render.** Rendering the
  slot server-side is the easy half; the trap is the client. Let the island resolve
  normally on its first client render and it suspends *inside* a boundary React is
  hydrating — React discards the server markup and client-renders it, which surfaces as a
  recoverable error (`ssrRender().hydrate()` throws on exactly this, and its message
  already named the cause: "a load that re-ran and re-suspended on its loading slot").
  Deferring to the post-hydration re-render is what makes the round trip silent — verified
  in a real browser too, not just jsdom: zero console output on `/deferred`.
- **`foldInputs` had to learn the option.** A `group` re-folds a child's mandala whenever it
  supplies a `loading`/`error` slot the child lacks — and a re-fold that didn't carry `ssr`
  would silently turn SSR back on for exactly the routes a group is most likely to wrap.
  Pinned in `router/group.test.tsx`.
- **No `ssr` default on `GroupDefaults`.** A group defaults *presentation* (wrapper, slots);
  "does this page gate TTFB" is a per-route judgment, and a group-wide opt-out would be a
  foot-gun that reads like a layout choice. Not cut, and not missed — say so if a consumer
  asks.
- **The fuzz suite never moved**, which is the tripwire working: the harness sets no `ssr`
  option, and `ssrEnabled` is a build-time constant, so the default path renders the exact
  element tree it did before.
- **A finding for SI-02, free:** the loading slot is threaded from a single place
  (`mandala.tsx`'s `Loading`) into all three sites that can show it — the Suspense fallback,
  a pending source in `Step`, and `ProvideLeaf`'s build frame. `loadingDelayMs` gates that
  one binding, so the delay does not need to be taught about the three sites separately.

### 2026-07-20 — SI-03 (`keepStale` + the status surface) shipped + decisions

Three commits: the engine + pins, the Router fix + gallery, then docs. 70 files / 615 tests.
**This is the batch's calibration gate — the semantics below are what B3/B4 build on.**

- **What is kept is the *run*, not a snapshot of its props.** The fork the item turns on.
  A props snapshot is a much smaller change, but the outgoing run is torn down with it —
  sources detached, `.provide()` value disposed — so the value channel would have had
  nothing of the right type to publish during the window, and `useScope` /
  `useRouteContext` would break for exactly the scopes that need this most (jnana's
  `pageScope` uses `.provide()`, and its param changing is the motivating case). Deferring
  only the dispose would instead leave a store alive over detached sources — the one
  ordering the engine repeats everywhere. So the kept run stays *whole*: buckets out of the
  discard path, sources attached, provided value alive and published, released in order
  (dispose → detach) when the successor commits. The record's own words point here —
  "the kept bucket", "the mandala already holds the committed bucket".
- **The Router keyed the feature out of existence, and no unit test could have caught it.**
  `Router` keys a route's element by a per-navigation counter, so *every* navigation
  remounts the component — and a remounted island has no previous run to keep. Every
  island-level pin passed while the gallery blanked. Fixed the way the mandala already
  carries `preload` / `moduleId`: `createMandala` hangs `keepStale` on the component and the
  Router keys those by route name. Opt-in, so every other route keeps its
  remount-per-navigation. **Worth a maintainer look**: this is a router behavior change,
  narrow but real, and `back()` through the entry stack now keeps content too (pinned).
- **The swap is passive, and belongs to the leaf.** Two ordering facts, both learned by
  failing: releasing from the leaf's *layout* effect detaches the old run's sources before
  the new run's are attached (layout effects run child-first, and the leaf is the innermost
  child), and releasing from an effect of the *mandala's* never runs at all — a Suspense
  retry re-renders the boundary's children, not the mandala.
- **`phase` is 'ready' during a stale window, with `isStale` beside it.** Not a fourth
  `'stale'` member, which would make `isStale` pure sugar for `phase === 'stale'` — two
  names for one bit, the thing the README's plain-naming rule exists to prevent. And
  'ready' is the honest read: content *is* on screen, and a subtree gating a skeleton on
  `phase === 'loading'` must not flip back to it under content the user is reading.
- **`isStale` is the kept-run flag only.** A selective `refresh(key)` also keeps its
  previous value rendered — but that has `pending`, which says *which* keys. Conflating
  them would turn `isStale` into "something somewhere is refetching".
- **Phase is reported by whatever renders**, during render, with the notify deferred
  (`addPending`'s established shape). No single piece of bookkeeping knows which slot is up:
  a level can be suspended on a promise, pending on a source, or thrown to the boundary
  without the mandala re-rendering. Reporting from render (not an effect) is what lets the
  kept run mark itself stale *before* rendering the component under it — otherwise the
  first stale frame renders undimmed and flashes.
- **`retry` is an alias of `refresh()` with no key**, kept because the error slot's prop
  already carries that name: a subtree offering the same affordance should spell it the same
  way. Flagging it as the one place this item adds a second name for one action.
- **A `rati/testing` bug, fixed in passing.** `renderIsland`'s `visibleNode` read only the
  *first* marker for a slot. A boundary showing its fallback keeps the previous children in
  the DOM (hidden) beside it, so under `keepStale` the DOM holds `content` twice — dead then
  live — and the harness reported the island blank. It now scans for the first *visible*
  match. Shipped in DX-02; nothing before this item could produce the two-marker DOM.
- **`yarn ci` is not reliably green on this machine, and it predates this effort.** The two
  mandala fuzz properties time out at 5000ms when the full 69-file suite runs under the
  contention of a whole `ci` pass; the dedicated `fuzz` stage does 1500 iterations in ~5s
  and passes. Verified by stashing every change in this item and running the same command:
  **identical failure on a clean tree**. Not investigated further here — worth its own look
  (a per-test timeout on the fuzz properties, or running them outside the parallel pool).
- **The fuzz tripwire held**: at `FUZZ_RUNS=1500` (3× the deep budget) the randomized
  suites pass, so default behavior is unmoved — the harness never sets `keepStale`, and both
  the option and the Router's keying are opt-in.

### 2026-07-20 — SI-02 (`loadingDelayMs`) shipped + decisions

Three commits: a `rati/testing` fix the pins needed, the engine + pins, then docs.
72 files / 628 tests; `yarn ci` green end to end here (including the fuzz stage that SI-03
found flaky on this machine), and the randomized suites hold at `FUZZ_RUNS=1500`.

- **The window measures a stretch without content, not a resolution.** The item's semantics
  are per-resolution ("render nothing until the delay elapses"), and taken literally that
  gives two flickers the option exists to prevent: a re-resolve superseding another
  restarts the deadline (so the user waits 2× staring at the same stale content), and one
  arriving while the slot is *already up* blanks it. So the gate latches — `expire` is
  sticky until content commits — and `begin` is a no-op on an open-and-paid window. Both
  edges are pinned. Reading it as "how long has this island been away from fresh content"
  makes every case fall out; reading it as "how long has this load been running" does not.
- **`keepStale` and `loadingDelayMs` are one mechanism with two release points.** The record
  said the delay needs SI-03's kept bucket; what it needs is the *whole* thing —
  `keepsRun = keepStale || delayed` engages capture, `bucketRetained`, `retainProvided` and
  the swap identically, and the only difference is that a bare delay releases the run at the
  deadline (via `releaseKept` from a mandala effect) instead of at the successor's commit.
  So the composed contract isn't a third behavior to implement, it is what happens when the
  release point never arrives.
- **The delay is one deadline because the slot became one element.** SI-04's parting finding
  (the loading slot is threaded from a single `Loading` binding into three sites) was half
  right: the *binding* was shared, but each of the three sites rebuilt the element and
  re-decided the stale substitution, so a per-mount timer would have restarted every time
  the slot moved between them. `Shared.slot` is now the built element — the mandala decides
  once what it is (kept run / slot / nothing) and `Step` and `ProvideLeaf` just return it.
  That deleted more code than the option added.
- **Split render/effect halves, because the server renders too.** `begin` runs where the
  generation is built (render) so the first client render is *already* holding — a gate
  opened from an effect would flash the slot before hiding it. But it starts no timer:
  arming in render would leave a `setTimeout` per island per request holding Node's event
  loop open. `arm` is the effect half, which the server never runs.
- **The hydration trap is SI-04's, mirrored.** An island whose loading slot legitimately
  belongs in the HTML (`ssr: false`, a source that stays pending server-side, a rejected
  load) would have it blanked by the delay on the first render that consults the *client*
  snapshot — not a mismatch, just a flash, which is exactly what the option is for. Two
  lines fix it: `false` as `getServerSnapshot` (inert on the server and through hydration,
  the `AfterHydration` trick again) plus the slot calling `expire` from its own render, so
  having shown it the delay can't take it back.
- **A route with only `loadingDelayMs` needed the Router change too**, so the flag
  `createMandala` hangs on the component is now `keepsRun` rather than `keepStale` — same
  keying, same opt-in, honest about covering both. Without it a delayed *route* would
  degrade to the first-load half on a param change (the Router remounts, and a remounted
  island has nothing to keep) while a delayed *island* kept content — the kind of split
  nobody would guess from the docs.
- **A `rati/testing` bug, fixed in passing (again).** `TestRouter.text()`,
  `renderWithStores`'s and `.hydrate()`'s all read `container.textContent`, which includes
  the previous children React keeps at `display: none` beside a Suspense fallback — so they
  returned the page twice. SI-03 fixed the same class of bug in `renderIsland`'s per-slot
  read; this is the container-wide twin, now one `visibleText` helper. It matters here
  because the delay's failure mode *is* a blank, and a hidden copy of the very slot under
  assertion hid it: the pin passed against a deliberately broken engine until this landed.
- **No gallery page, on purpose.** The gallery foregrounds server/client behavior and the
  delay is inert on the server — its whole story is a few hundred milliseconds of client
  timing, which a static page can only describe, not show. The two existing options it
  composes with (`/product`'s `keepStale`, `/deferred`'s `ssr: false`) already carry the
  loading-state story there. Same call as SI-01's.
- **Fake timers work fine under `act`** (Vitest leaves `queueMicrotask` real, which is what
  React's act queue and the gate's notify ride on), so the deadline is a step rather than a
  wait — and `vi.getTimerCount()` around mount/unmount is the timer-leak pin, measured as a
  delta so React's own timers don't matter.

### 2026-07-20 — SI-05 (retry policy) shipped + decisions

Two commits: the engine + pins, then docs. 72 files / 639 tests; `yarn ci` green, and the
randomized suites hold at `FUZZ_RUNS=1500` (the harness sets no `retry`, so the policy is
unreachable there — the tripwire never moved).

- **An accepted failure is not an error state, so the decision belongs to the boundary's
  *render*.** The fork the item turns on. Deciding from an effect (`componentDidCatch`,
  where a timer would naturally live) is one line shorter and wrong: React renders and
  *commits* the error slot before any effect could take it back, so the slot's own effects
  run — the log, the toast, the Sentry report — for a failure the island is about to fix.
  Pinned by counting error-slot renders, not by reading the DOM. `accept` is therefore
  render-time and idempotent per generation; `arm` is the commit-time half.
- **That split is also the whole of "client-only" — no gate needed.** The record asked for
  SSR to be pinned; it turned out to need no code. Only a commit can start a timer and a
  server render has no commit phase, so `prerender` takes its one attempt per request and
  the collector records the failure byte-identically to an island without the option
  (pinned against a no-policy twin). The `ssr: false` finding's `getServerSnapshot` gate
  would have worked too and buys nothing here.
- **Keyed on the generation, not the thrown value.** The obvious idempotency key for "have I
  already ruled on this error?" is the error's identity — and a static rejected promise
  (`load({ post: failingPromise })`) hands the *same* reason object to every generation,
  which would retry forever on a fresh budget each time. `resetKey` (the tree key) is the
  only identity that separates one failure from the next, and it is already a boundary prop.
- **The budget is restored from three places, and the third one is the trap.** Content
  committing and a manual retry are obvious. The param change is not: reset it from render
  and a *synchronous* first failure loses the attempt it just armed (the mandala's effect
  runs after `componentDidCatch`), reset it from the tree-key effect and the same thing
  happens one frame later. `committed(version)` compares the inputs version instead, and
  starts at `0` because that is the version the policy is constructed under.
- **`retrying` is a number on the status, not a fourth phase.** SI-03's rule applied twice
  over: `phase` means "which slot is on screen", and during a retry that is the loading slot
  (or kept content) — a subtree gating a skeleton on `phase === 'loading'` must keep showing
  it. The count is the useful part anyway ("Retrying (2)…"), and `0` reads as "not". It
  clears in the error slot too: a spent budget is not a retry in progress.
- **`keepStale` composes for free, and `loadingDelayMs` does too.** The boundary renders the
  mandala's *built* `slot` — the same element SI-02 collapsed the three loading-slot sites
  into — so kept content stands in front of a retry exactly as it stands in front of any
  re-resolve, and a delay still holds the slot back during the backoff. Nothing in this item
  knows about either option.
- **A component that throws in render is retried like a load that failed.** The boundary
  catches everything under it and `asSourceError` maps a plain `Error` to `code: 'failed'`,
  so a render bug gets `count` re-mounts before the error slot. Not worth plumbing a
  load-vs-render distinction down from the resolver for — the manual `retry` has always
  re-thrown the same way — but it is the one place the `failed`-only rule is blunter than it
  reads.
- **The kept content remounts across the backoff — on top of a remount `keepStale` already
  does.** The boundary swaps its whole child (`<Suspense>` → the slot element) to show the
  slot in place of the error, so under `keepStale` the user's component unmounts and
  remounts around each attempt. Measured, not reasoned: a plain `keepStale` re-resolve
  already logs `mount page a` on entering the window (the kept run renders in the Suspense
  *fallback* position, a different fiber slot from the live tree), and each automatic attempt
  adds an unmount/mount pair on top. Same surgery the error slot has always done, and
  invisible for a spinner; worth knowing for a heavy kept page. Avoiding it means inverting
  boundary/Suspense, which a lot of SSR behavior sits on — not this item's call.

**A finding out of scope, for the maintainer.** The measurement above says `keepStale`'s
stale window **remounts the component**, which nothing in SI-03 or the docs claims — the
guide says "the component re-renders with the *previous* params' props", and `re-renders` is
what a reader would bank component state and scroll position on. Visually it is invisible
(same props, same output), so no pin caught it. Whether that is a bug or the price of
rendering the kept run from the fallback position is a semantics call on top of the item
that set the semantics; not touched here.

### 2026-07-20 — SI-06 (`ssrErrors: 'dehydrate'`) shipped + decisions

Three commits: the engine + pins, the gallery page, then docs. `yarn ci` green end to end;
73 files / 656 tests. `islandSsrErrors.test.tsx` is untouched, and the randomized suites hold at `FUZZ_RUNS=1500`
(the harness sets no `ssrErrors`, and the mode is unreachable off a collected server
render — the tripwire never moved). **This closes the effort.**

- **The catch cannot be a `try` around `use()`, so the promise has to change instead.** The
  fork the item turns on. A pending `use()` throws too (React's Suspense signal), so
  catching at the call site means telling one throw from the other by shape — a bet on
  React's internals. The Step waits on a *rejection-proof twin* instead
  (`promise.then(undefined, reason => new SsrRejection(...))`), which resolves where the
  original rejects, and the resolve pass reads a value where it would have caught. The
  original promise is untouched, which is what keeps `recordRejection` — and DX-08's
  hardening of it — the one path that feeds the status list.
- **The twins are keyed by promise, not held on the cell.** `use()` needs one identity
  across a level's resume, and the obvious home is the cached cell — except a *hook* load
  has no cached cell (it re-classifies its result every render), so a per-cell field would
  have quietly excluded `hook(() => fetchThing())` from the mode. A WeakMap on the run
  covers both, and sits next to the rejection ledger it is the twin of.
- **Throwing during hydration is not a recoverable error** — measured before designing
  around it, because the whole round trip depends on it. React catches it in the boundary,
  re-creates that subtree from scratch, and reports *nothing* to `onRecoverableError`; the
  server rendered the same slot, so the swap is invisible. That is what let the client half
  be a `kind: 'error'` cell that simply throws, rather than a second way to render the
  error slot — one door, so SI-05's policy sees a dehydrated failure without being told
  about it. (It does log to the console in dev, as any boundary-caught error does. An
  island that failed on the server being loud in dev reads as correct; documented.)
- **The mode is gated on the collector**, like the source-side `ssr` marker and for the
  same reason: with nothing to carry the failure over, painting the error slot would only
  mean the client paints something else a moment later. Found by a test rather than by
  reasoning — the `group` re-fold pin used `prerenderToString` and got the default
  degradation. Worth contrasting with SI-04's finding, which *widened* `ssr: false` past
  the collector to `getServerSnapshot`: there the widening made the option more honest,
  here it would manufacture the mismatch the option exists to avoid.
- **The wire section is omitted when empty**, so an app that never sets the option ships a
  byte-identical payload and needed no version bump. A client predating the section ignores
  it and re-runs the load, which is the default behavior — the graceful direction.
- **`cause` is the only field dropped, and the `message` is the trade.** A live `Error`
  JSON-stringifies to `{}`, so shipping it would hand the client a lie shaped like a cause.
  The message travels because the error slot exists to show it — and it lands in the HTML
  for anyone to read, which is the one thing an author must know before opting in. Said in
  the option's doc, the reference, ssr.md and on the gallery page; a load whose failures
  carry backend text should say something else before rejecting.
- **The collector grew a second error field, not a flag on the first.** `errors` (the flat
  list) is the server's status input and never leaves the server; `dehydratedErrors` is the
  wire section. Deriving one from the other at read time would have put the same filter in
  `renderApp` and `ssrRender`, and a `dehydrated` flag on the public `HydrationError` would
  have churned a type for bookkeeping that isn't the reader's business.
- **The retry policy picks a dehydrated failure up** — the interaction the record asked to
  rule on, decided as recommended. The policy asks one question (is this a `failed` I have
  budget for) and where the failure came from is not part of it; the alternative is a hidden
  rule that an explicitly configured option silently doesn't apply to one error. The
  consequence is real and pinned: with both set, the error slot the HTML shipped is replaced
  by the loading slot on the *first* client render (the boundary rules during render, so it
  never mounts), and the deterministic paint is the server's only.
- **A `not-available` gets a rendered 404 page.** Falls out for free — the status derivation
  never sees the mode — and is probably the most useful case: the server already knew the
  entity was missing, and the HTML can say so instead of spinning.
- **Nothing was done for a plain source that errors server-side.** Under SSR an unmarked
  source stays pending, so this needs a synchronously-errored one; it throws and degrades as
  it always has, in both modes. Consistent with the baseline (`recordRejection` is promise-
  only, so such a failure reaches neither `errors` nor the status), and noting it here
  because *that* is the older gap this item declined to widen its scope into.

### 2026-07-20 — post-effort review (the flagged findings, addressed)

A grounded re-read of everything the items shipped (engine, Router, boundary, policy,
delay, tests), plus measurement where an item had only reasoned. What came of each open
flag:

- **The stale-window remount (SI-05's out-of-scope finding) is confirmed by measurement,
  and is one instance bigger than described.** Counting mount/unmount effects: entering the
  window mounts a *second* instance of the component (the kept content, in the Suspense
  fallback position) while React keeps the outgoing committed tree hidden beside it; both
  unmount when the successor commits, which mounts a third. And a site move mid-window — the
  not-ready position shifting from the fallback to a later level's pending source — is
  another unmount/mount pair, which disproves the SI-02/SI-03 line that the shared slot
  element's identity keeps the component from remounting "as the tree moves between them":
  one element only stabilizes re-renders at a single site; the sites are different fiber
  positions. **Decision:** the semantics stand (the motivating case wants visual
  continuity; the kept *resources* — sources, the `.provide()` value — are what must
  survive, and do), and the docs now say so instead of "re-renders": guide + reference
  (`keepStale`, plus a clause on `retry`'s per-attempt remount), the `keepStale` and
  `isStale` jsdoc, internals §The kept run, and the two code comments that carried the
  disproven claim. True instance continuity is recorded as an open direction
  (`docs/research/scope-and-island-directions.md`, "in-place stale window") — a resolver
  restructuring or React `<Activity>`-class rendering, not a patch; wait for a consumer who
  actually loses state.
- **The Router keying change (SI-03's "worth a maintainer look"): reviewed, endorsed, no
  change.** Opt-in via `keepsRun`, keyed `route:<name>` (unique by construction), still
  remounts across routes, `back()` through the entry stack pinned in
  `routeKeptRun.test.tsx`. The behavior change is exactly the one the option asks for.
- **The fuzz flakiness (SI-03) had a one-line root cause.** `fuzzTimeout()` already existed
  for this class of false failure (the mandala-fuzz effort's) but was applied only to the
  *router* properties — the two mandala properties sat on vitest's default 5s, which
  full-`ci` contention alone exceeds — and its floor was the same blind 5s. Applied to the
  mandala properties, floor raised to 30s (it is a hang-catcher, not a performance gate).
- **A small status-surface doc bug found in review:** the `isStale` jsdoc claimed the flag
  is `keepStale`-only, but a bare `loadingDelayMs` island's window also reports it (the
  kept run reports for itself, whichever option keeps it — reference and guide already said
  so). Fixed at the jsdoc.
- **SI-01's two deliberately-open seams** (per-key cancellation for the superseded
  `refresh(key)`, the SSR request-abort seam through `renderApp`) graduated from
  findings-prose to recorded research directions in the same doc, so they are findable
  where directions are looked for.
- **No new planned items cut.** Everything decision-free was fixed in-review; the three
  open directions are wait-for-need by the research tree's discipline.

## Per-item conventions

Atomic commits on the current branch (rati `CLAUDE.md`); subjects prefixed `SI-NN:`, a
`Closes: SI-NN` trailer on the finishing commit. `yarn ci` green before handing over
(`scripts/ci.ts` — fmt / lint / typecheck / test / deep fuzz / build). Public surface changes
document in `docs/current/public/` (guide + reference) in the same item;
`docs/current/internals.md` when the mandala's machinery changes. Findings out of an item's
scope get a dated note appended here.
