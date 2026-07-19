# DX-06 — Jnana adoption leg (the success test)

area: cross-repo — jnana frontend/test (rati consumed via rati-dev)
needs: DX-05 (utilities proven at home first)
disposition: cut 2026-07-19, DATA-03's pattern: if the migrations don't get shorter and
             honester, the utilities are wrong

## Problem

Jnana's component tests fake rati instead of driving it: ten files build structural fake
containers cast `as unknown as GlobalStores` through a context the stores-container effort
has since internalized; five files stub the router surface with `vi.fn()` objects; two files
`vi.mock('rati')` to neuter `Link`. Every one of those is a place where a test asserts
against a hand-written imitation of the framework rather than the framework. The survey
(effort README) lists the files.

## Scope

The three legs, in rising order of surface exercised:

1. **Stores injection** — the ten fake-container files move to the DX-03 seam (partial
   containers of partial stores, no container cast). The interesting case is the smallest
   partial: a component reading one store slice should need one *slice* in the test.
   **Default to `storesWrapper` + the file's existing renderer** (RTL in jsdom,
   `vitest-browser-react` in the browser project) — `renderWithStores` only where a file has
   no renderer worth keeping. The two `.browser` files must use `storesWrapper` (rati's
   act-based mount is off-philosophy in real-browser mode and double-harnesses cleanup).
2. **Router** — the five fake-router files move to `createTestRouter` (real matching, real
   navigation asserts instead of `vi.fn()` call records) where the test cares about routing
   — with **minimal local route tables** carrying just the names the assertions resolve
   (importing `frontend/src/routes.ts` drags ~40 page+scope modules into a unit test) — or
   to the typed partial where the test only needs a router-shaped presence (note: a
   `{ navigate: vi.fn() }` fake inside the partial still needs a per-store cast to
   `RouterStore` — record it as a survivor, or give the file a real test router). Judgment
   per file; record which way each went. `test/boot/fakes.ts`'s `fakeRouter` does **not**
   move to `createTestRouter` (2026-07-19 correction: it is a store-level slice consumed
   only by `bootHarness.ts`, which Boundaries below exclude, and a React mount harness is
   the wrong shape for it) — it may become a bare
   `new RouterStore({}, [], { history: createMemoryHistory(…) })` or stay a justified
   survivor.
3. **`Link` mocks** — the two `vi.mock('rati')` factories die; the tests render real
   `Link`s against a test router (`createTestRouter(localRoutes, { ui: <LoginPage />,
   stores: { authStore } })` is the shape — `useRouter`'s `instanceof RouterStore` check is
   why nothing less than a real store works).

For each leg: line-count and concept-count before/after, and a dated findings note in the
effort README — especially anywhere the utilities forced a workaround (that is the signal a
rati-side item needs). Also: `.claude/frontend-testing.md` gains the section it is missing
(how to test rati-dependent components — the survey found the ten-file pattern entirely
undocumented); write it once the migrated shape is settled.

## Boundaries

- Jnana-side commits follow Jnana's conventions, not rati's; this record tracks findings
  and the rati-side fixes they force.
- No new rati surface mid-migration: a missing capability becomes a README finding (or a
  new item), not an ad-hoc export.
- Jnana's bespoke harnesses (boot, editor, list fixtures) are out of scope — only the
  rati-primitive fakes migrate.
- `FetchStore`'s own tests stay (the store is MobX-based, not a rati source; its `deferred`
  may adopt the generic helper, nothing more).

## Verify

- Jnana's own gates green after each leg (`frontend-unit` + `frontend-browser` projects).
- The before/after deltas recorded in the effort README with the findings.
- Grep gate in jnana tests: no `as unknown as GlobalStores`, no `vi.mock('rati'`, no
  hand-rolled `{ navigate: vi.fn()` router objects — each survivor justified in the note.
  Calibration (2026-07-19): the *container-level* cast is what dies by design. Expected
  survivors, pre-justified: the five files faking a container as a **constructor argument**
  (`workspaceStores`, `UIStore.hostStatus`, `UIStore.syncPaused`, `resolveReadonlyReason`,
  `readonlyWorkspace` + the two in-file ctor casts) — out of any render-utility's reach, a
  Jnana-side `fakeContainer()` fixture if worth it; and per-field casts on *nested* fakes
  (a `user` model on a store) that `PartialStores`' one-level depth doesn't cover.
- Jnana keeps its act-environment policy: rati/testing now scopes the flag around its own
  `act` calls only, so `unitSetup.ts`'s deliberate no-global stance survives the migration
  untouched — if a migrated file starts warning, that's a finding, not a policy to flip.
