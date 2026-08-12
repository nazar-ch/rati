---
area: package.json, .claude/kit.json
needs:
status: open
disposition: —
---

# FND-11 — the declared verify gate cannot run: there are no `verify:*` scripts

## Problem

`.claude/kit.json` declares `"verify": "verify.ts"`, and the kit's runner works by enumerating the
repo's `verify:*` package.json scripts. rati has none:

    $ verify.ts
    verify: FAILED — no `verify:*` scripts in package.json; the gate would be empty.
    $ echo $?
    2

    $ jq -r '.scripts | keys[]' package.json
    ci  fmt  lint  lint:types  prepare  release  test  typecheck  upgrade  …

The pieces a gate would run all exist — `fmt`, `lint`, `lint:types`, `typecheck`, `test`, and a `ci`
script that presumably chains them. They are simply not named in the form the runner looks for.

Measured 2026-08-01 on the `mac` guest, incidentally: a session touching only `.claude/kit.json`
(kit◊FND-108) tried to run this repo's declared gate before pushing and could not.

## Why it matters

Every kit consumer's contract is "verify before you push", and the manifest advertises a gate that
exits 2 without checking anything. An agent that reads the manifest, runs what it names, and takes
the failure at face value has no way to validate a change here — and one that shrugs at exit 2 has
learned to push unverified. The `release` script publishes the public `rati` package to npm, so this
is the repo where an unverified push is least affordable.

## Shape of the cure (not settled here)

Either rename/alias the existing scripts into the `verify:*` namespace the runner enumerates
(`verify:fmt`, `verify:lint`, `verify:typecheck`, `verify:test` — likely what `ci` already chains),
or point the manifest's `verify` at `vp run ci` if that script is meant to be the gate. The first
keeps rati on the shared runner and its per-step reporting; the second is one line but opts out of
it.

## Verify

- `node_modules/.bin/kit-verify` from a clean checkout exits 0 and names the steps it ran.
- A deliberate lint/type error makes it exit non-zero and names the failing step.
