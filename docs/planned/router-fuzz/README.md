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
work is [mandala-testing.md](../../research/mandala-testing.md); this effort does not
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

## Items

RF-01 executes the review findings above — the codec decision, the substitution fix, the
error, the dispose — each fix with its pin, before the fuzz suite would trip over them
(the model's round-trip expectation and the engine would disagree on finding 1). RF-02
builds the foundation: the traversable memory history, the routes-table arbitrary, the
reference model (URL × entry stack → expected route), a navigate-everywhere smoke
property — and is the **calibration gate**: its review fixes the invariant altitude.
RF-03 adds the command alphabet and the behavioral invariants; RF-04 audits the existing
21 suites against the pin list and adds only the missing pins — the two run as parallel
lanes. RF-05 closes with the kill audit and non-vacuity verification.

Batching, dependencies, grading: [plan.md](./plan.md).

## Findings

(Appended as dated notes as items execute; a real router bug is a finding to surface, not
to silently fix.)

## Per-item conventions

rati works in atomic commits on the current branch (its `CLAUDE.md`); prefix subjects with
the item id (`RF-01: …`), put `Closes: RF-01` in the finishing commit's trailer block, keep
`yarn ci` green (`scripts/ci.ts` — the whole gate, deep fuzz budget included), and push.
Findings that are out of an item's scope get a dated note appended here, not a silent fix.
