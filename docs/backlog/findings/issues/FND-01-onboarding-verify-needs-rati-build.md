---
area: ci, dx
needs:
status: open
disposition: —
---

# FND-01 — the pre-push `verify` gate is not self-contained on a fresh checkout

## Problem

On a checkout that has never run `vp run rati#build` — every freshly-provisioned sandbox VM — both
`yarn ci` and the pre-push subset it backs (`yarn ci fmt lint typecheck test`, rati's `verify` in
`.claude/kit.json`) fail at `typecheck`:

```
# examples/ssr, tsconfig.node.json (serve.ts, vite.config.ts):
error TS2307: Cannot find module 'rati/server' or its corresponding type declarations.
error TS2307: Cannot find module 'rati/ssr' ...
error TS2307: Cannot find module 'rati/vite' ...
```

Build-order dependency the `verify` subset can't satisfy:

- `scripts/ci.ts`'s `typecheck` stage runs `ssr-demo#typecheck`. That workspace's
  `tsconfig.node.json` uses `moduleResolution: nodenext` with **no `rati-dev` customCondition**, so
  its node-side files resolve rati's `server`/`ssr`/`vite` entries through the *published* export
  conditions — i.e. `packages/rati/dist/`. (`demo#typecheck` passes: the client tsconfig carries the
  condition and resolves to `src`.)
- `dist/` exists only after `vp run rati#build`, and in `ci.ts` the `build` stage runs **last**; the
  pre-push subset omits it by design.
- The kit's `bootstrap` for this repo is `yarn install` only, so a provisioned checkout has no
  `dist/`.

One `vp run rati#build` clears it and it persists for the session, so this is friction rather than
breakage — but it lands on the *first* gate a new environment runs, and nothing in `CLAUDE.md`'s
workflow says "build once before your first verify".

## Why it matters

A gate that cannot pass on a clean checkout teaches the reader to distrust it: the first red is
inherited, so the second one is read as inherited too. It also breaks a kit-wide assumption — that a
provisioned checkout passes its own `verify` straight away — which is what the onboarding pilot
existed to test.

Surfaced by the `KIT-16` rati/lima2 pilot session (jnana-kit-feedback
`records/2026-07-23-rati-lima2-verify-needs-rati-build.md`); filed here by that sweep's triage.

## Options

Not yet decided — whichever is taken, the check is that a fresh clone passes `verify` with no manual
build:

1. Give `examples/ssr/tsconfig.node.json` `"customConditions": ["rati-dev"]`, so its node typecheck
   resolves rati from `src` like the rest of the dev flow and needs no `dist/`.
2. Make the `typecheck` stage depend on `rati#build` — self-contained, at the cost of a build in the
   fast pre-push subset.
3. Document "run `vp run rati#build` once after bootstrap" in the workflow, and leave the gate as
   it is.

Worth checking whether the other tenants have the same published-vs-`rati-dev` resolution split in
their SSR examples before picking.
