---
area: packages/rati/package.json
needs: —
status: done
disposition: —
---

# SSR-09 — rati/server without a react install

## Problem

`react` is a non-optional peer of the package, but the built `dist/server/index.js`
imports only `node:*` builtins and the react-free `html-*` chunk. A server-only
workspace that installs rati purely for `createRequestHandler` (jnana's
`website/server`) gets a spurious peer warning and is told to install React to run a
Node listener. The entries are already sliced; the peer declaration isn't —
`react-dom`, `mobx`, and `vite` are already optional in `peerDependenciesMeta`.

## Scope

Mark `react` optional in `peerDependenciesMeta`. Every app consumer imports React
themselves to write components, so the lost warning protects nobody in practice.

## Boundaries

- No package splitting, no conditional exports gymnastics — the anti-bloat line from
  ssr-server-kit.md stands.

## Verify

`yarn install` warning-free in a react-less consumer shape (a scratch workspace or
jnana's `website/server`); `vp run rati#build` unchanged.
