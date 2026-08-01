#!/usr/bin/env bash
# why-shell: guest provisioning — runs on a bare VM before this project's toolchain (or any
# node_modules) exists, so it cannot be anything that needs them.
#
# rati's provision hook: the project-owned layer of a shared sandbox VM (jnana-kit registry
# `provisionHook`; docs/design.md §3). The kit base clones this repo and calls this. rati needs
# nothing beyond the base — no database, no services, no seed, no credentials — so this is just
# "install deps": the packages/rati bundle and the examples/{demo,ssr} Vite dev servers all run
# from one Yarn-workspaces install. Node 26, git auth, the kit checkout, and the skills are the
# base's; don't restate them here.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO"

echo "==> provisioning rati at $REPO"

# Make the checkout runnable — the same command the manifest declares as `bootstrap`
# (.claude/kit.json). Installs the monorepo (packages/rati + examples/{demo,ssr}) under Node 26 and
# Yarn 4.17.1; idempotent, so a re-provision on every `up` is a no-op once deps are current. Expect
# the non-fatal Yarn YN0066 compat warning from the released TypeScript 7 devDependency.
yarn install

echo "==> rati: provisioned"
