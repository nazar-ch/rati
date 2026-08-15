---
area: packages/rati/src/util/utils.ts (is.class) + a regression test; CLAUDE.md "Known" note falls when fixed
needs: nothing
status: done
disposition: —
---

# FND-03 — `is.class` breaks under minification (the `/counter` blank page)

## Problem

`is.class` (utils.ts:75) detects a class by `Function.prototype.toString.call(value).startsWith('class ')`. Minification rewrites `class CounterStore {…}` into an anonymous `class{…}` — no space — so the check returns false and the scope's class load is called without `new`, which throws and renders the ssr example's `/counter` blank in any *production* build (dev is fine; known issue, recorded in CLAUDE.md §Examples).

This stopped being cosmetic: the class-factory load is the blessed way to build per-key store classes over `reconciled`/`keyed` (DATA-13/DATA-14), so prod-broken class detection undermines the pattern the data effort is standardizing.

## Direction (maintainer, 2026-07-25)

Fix the detection — **no explicit markers** (no `Symbol`/static-brand opt-in). The `is` helpers were ported from an existing type-detection library; the original may handle this case in a way the port missed — find the source (e.g. libraries of the `is-class` family test `/^class[\s{]/`, catching the minified form) and take its handling. If a string-shape fix cannot be made to hold (e.g. a build that downlevels classes to functions entirely), **keep this record open** and report what was found rather than forcing a marker.

## Scope

1. Identify the original library `is.class` was ported from (check history/comments; compare its current upstream implementation) and port the missed handling.
2. Unit-test the shapes: named class, anonymous minified `class{…}` (build one via `new Function('return class{}')` so no formatter un-minifies it), arrow fn, plain fn, `function` with "class" in its body string.
3. Prove the real repro: `vp build` the ssr example, confirm `/counter` renders in the production server (`vp run rati#build` + `vp run ssr-demo#start`); remove the CLAUDE.md §Examples "Known" paragraph and the matching internals note if one exists.

## Boundaries

- No API change to scope/class loads; no marker protocol.
- Downleveled-class targets (classes compiled away) are out of scope — record, don't chase.

## Verify

- `yarn ci` fully green (this touches the engine's load path — run the full gate, not the fast subset).
- The production `/counter` page renders; the unit matrix passes.

## Outcome (2026-07-25)

The port's origin is **@sindresorhus/is** (named in the licence header above `is` in utils.ts), which closed this exact hole in **7.1.1** — "Fix `is.class` for minified class expression" (#217) — by testing `/^class(?:\s+|\{)/` rather than `startsWith('class ')`. rati now tests `/^class[\s{]/` (same shape; the port had frozen the pre-7.1.1 form). No marker was needed.

Worth recording for whoever reads the old note: **curl cannot see this bug.** Vite does not minify the SSR environment, so the server HTML was always correct — the break was client-only. Headless Chrome against the production server:

- before — `#root` empty (React discarded the good server HTML), console `Uncaught TypeError: Class constructor dc cannot be invoked without 'new'`, where `dc` is the bundle's `class{count=0;…}`;
- after — the counter markup renders, no console error.

REV-03 step 1 ("the known bug first") is satisfied by this; the rest of that item — including its minification-robustness sweep for sibling string-shape assumptions — stands.
