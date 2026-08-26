---
area: src/data (form, field, query), src/util/utils.ts
needs:
status: open
disposition: —
approved: user, 2026-08-26 — routed from the jnana agent-testing-space session (2026-08-26)
---

# FND-12 — `rati/data` reads MobX observables outside a reactive context

## Problem

A consumer that runs MobX in strict mode — `configure({ observableRequiresReaction: true })`, which jnana does in `frontend/src/main.tsx` — gets a console warning for every observable `rati/data` reads from an imperative path. Measured 2026-08-26 on the `mac` guest, driving jnana's dev app in Chrome with `console.warn` hooked to capture stacks:

- **Submitting a form — 7 warnings.** `form.submit()` reads `isSubmitting` before it decides to run (`dist/data/index.js:453`, `if (!n.isSubmitting && a.validate())`), and the validate pass plus the values read each field's `.value`. A three-field sign-in form warns once for `isSubmitting` and six times for `.value`.
- **Opening a page that primes a query — 1 warning.** `hasData` is read inside `prime` (`dist/data/index.js`, `Object.v [as prime]`).
- **A source's structural comparison — one per property, per compare.** The deep-equality helper in `src/util/utils.ts` walks `Object.keys` and reads every property of both sides; where the consumer's value is a deep MobX observable, that is a tracked read per property from an untracked path.

None of the reads is wrong — they are imperative by design, the way an action or a side effect reads state. MobX's strict mode cannot tell that apart from a component that forgot to observe, so it warns.

## Why it matters

The warnings are noise a consumer cannot silence without turning the check off for its own code too, and volume hides the real ones. In jnana the third case dominated: `SpacesStore.spaces` held deep-observable wire payloads, so every compare over a three-space list produced **~9 700 warnings on a single boot** — enough that a genuine `observableRequiresReaction` warning was unfindable. That consumer fixed its side (the list is `observable.ref` now, its items plain), which is the right fix for that case and leaves the other two standing.

## Shape of the cure (not settled here)

Wrap the imperative reads in MobX's `untracked()` at the three sites, so a read that is deliberately not a derivation says so. `rati/data` already depends on MobX, and `untracked` is a no-op cost. The utils comparison is the awkward one — it is core, MobX-free, and reached from `rati/mobx`'s bridge rather than by importing MobX itself; the option there is to keep the read untracked at the bridge instead.

## Verify

- A consumer app under `configure({ observableRequiresReaction: true })` submits a form, primes a query and re-resolves a source over an observable value, with zero `[mobx]` warnings attributed to `rati`.
- The gate (the command `.claude/kit.json` `verify` names).
