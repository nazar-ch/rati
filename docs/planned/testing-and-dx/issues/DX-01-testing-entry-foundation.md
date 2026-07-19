# DX-01 — the `rati/testing` entry: `deferred`, `flush`, `controllableSource`

area: packages/rati/src/testing/ (new), packages/rati/package.json (exports map),
      packages/rati/vite config (build inputs), docs
needs: —
disposition: cut 2026-07-19 from dx-and-tooling.md §Test utilities + the survey
             (README §Survey)

## Problem

Both repos hand-roll the same three primitives — a deferred promise (10 copies across the
two repos), an act-microtask flush (2 named copies + a 100+-use raw idiom), and a
controllable source (~8 copies, the best one locked in `__tests__/fuzz/scopeHarness.tsx`).
There is no public entry to put them on. This item creates the entry and sets its style;
everything later copies it.

## Scope

1. **The entry.** `src/testing/index.ts`, wired into the exports map exactly like `./ssr`
   (`rati-dev` / `types` / `import` / `source`), included in the lib build + `.d.ts` emit.
   Verify the built output doesn't pull testing code into the main chunk (`sideEffects`
   stays honest).
2. **`deferred<T>()`** — `{ promise, resolve, reject }`. The 6 rati copies are the spec;
   nothing fancier.
3. **`flush(times?)`** — the act-microtask helper. Decide and document the `act` sourcing
   (import from `react`; the helper is test-environment-only and says so).
4. **`controllableSource<T>()`** — promote the fuzz harness core: a real `Source` with
   `setReady(v)` / `setError(e)` / `setPending()` / `emit(v)`, an attach/detach ledger
   (`attachCount` or equivalent — the leak-test use case), and the `ssr: true` loader
   variant (the `islandSsrSources.test.tsx` shape) as an option, not a second export.
   Naming: research doc says `.setReady/.setError/.reset` — reconcile with what the ~8
   hand-rolled copies actually needed (they pend/re-ready repeatedly; `reset` alone is too
   weak) and record the decision.
5. **Style decisions this item pins for the effort** (the B1 checkpoint's subject): naming
   conventions, options-bag shapes, whether `@testing-library/react` is an optional
   integration or absent entirely, and where the reference.md `rati/testing` section sits.
6. **Prove it:** convert two real suites (one mandala, one data) to the new primitives
   in-item — not the full sweep (DX-05), just proof the API fits.
7. **Docs:** reference.md gains the `rati/testing` section (entry intro + these three);
   internals.md notes the fuzz-harness cores now import from it (or how they relate).

## Boundaries

- No island/router/SSR harnesses here — DX-02/03/04.
- The fuzz harnesses keep their own drivers where they are fuzz-specific (ledgers wired to
  the model, testids); only the generic cores move.
- No new runtime dependencies; peers unchanged.

## Verify

- `yarn ci` green; `vp run rati#build` emits `dist/testing/index.js` + `.d.ts`, and the
  main entry's built output is byte-identical to before this item (the entry must be
  side-effect-free and unreferenced from `main.ts`).
- The two converted suites pass unmodified in behavior (same assertions, fewer local
  helpers).
- Type tests: `deferred<T>` and `controllableSource<T>` infer `T` through their drivers.
