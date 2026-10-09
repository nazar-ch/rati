#!/usr/bin/env bash
# why-shell: provision-hook — the kit's provisioning contract spawns `bash <checkout>/<hook>` on a
# guest it has just cloned into, so the entry point cannot be anything else, and it runs before this
# project has a toolchain (any node_modules) of its own.
#
# rati's provision hook: the project-owned layer of a shared sandbox VM (jnana-kit registry
# `provisionHook`; jnana-kit:///docs/design.md — the kit's tree, not this one). The kit base
# clones this repo and calls this. rati needs nothing beyond the base — no database, no services,
# no seed, no credentials — so this is "install deps": the packages/rati bundle and the
# examples/{demo,ssr} Vite dev servers all run from one Yarn-workspaces install. Node 26, git auth,
# the kit checkout, and the skills are the base's; don't restate them here.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${REPO}"

echo "==> provisioning rati at ${REPO}"

# The manifest's `bootstrap` command (.claude/kit.json), a no-op on every `up` once deps are
# current. Yarn's YN0066 compat warning from the TypeScript 7 devDependency is non-fatal.
yarn install

echo "==> rati: provisioned"
