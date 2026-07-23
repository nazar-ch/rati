---
area: packages/rati/package.json (exports map, files, peers, sideEffects), the vite lib build + tsgo emit, minified consumer builds, examples as build evidence
needs: — (suggested first lens: it gates trusting production builds elsewhere)
status: open
disposition: cut 2026-07-19; production-review lens 3. Carries the effort's one known bug.
---

# REV-03 — packaging & production build

## Problem

Nobody has audited what `yarn npm publish` would actually ship or how rati behaves after a
consumer's *minified production* build — and one defect there is already known: the
gallery's `/counter` renders blank in any production build because `is.class`
(`util/utils.ts:75`) detects classes via `Function.prototype.toString().startsWith('class ')`
and minifiers rewrite `class CounterStore {…}` into forms that defeat it, so the class load
is called without `new`. A whole class of hazards lives at this altitude: things invisible
in dev (`rati-dev` serves source) and in rati's own tests, visible only in a stranger's
bundler.

## Scope

1. **The known bug first.** Fix `is.class` or the class-load mechanism (options: a
   robustness rewrite of the detection; an explicit marker for class loads; calling
   convention detection at runtime via try/catch — weigh, pick, document). This one is
   pre-decided as in-scope to *fix*, not file; pin with a test that survives minification
   (run the check against a minified fixture, not just source).
2. **Publish payload.** `yarn npm publish --dry-run` (the one safe form — never a real
   publish): read the file list. `files`/`.npmignore` correctness, no test/fuzz/docs
   leakage, dist complete for every entry, `README`/license presence. Does the published
   `exports` map resolve every entry under plain node ESM (`node -e "import('rati/ssr')"`
   against a `yarn pack` install in a scratch dir)? The `rati-dev` and `source` conditions
   in a *published* context: harmless or a trap for consumers whose tooling resolves
   unknown conditions?
3. **Peers & duplication.** `peerDependencies` ranges honest (react/react-dom versions
   actually supported — coordinate with REV-07's findings; mobx optional-peer wiring
   correct so non-mobx consumers install clean)? The double-React hazard (a consumer's
   dedupe failing) — what breaks, is the failure legible?
4. **Tree-shaking & side effects.** `sideEffects: false` is claimed — audit it (any
   module-scope effect anywhere in `src/`? scrollRestoration, channels, globals?). Build a
   scratch consumer importing one small thing from `rati`; measure what lands in its bundle
   (per-entry too). An unused entry must cost zero bytes.
5. **Minification robustness sweep.** The `is.class` bug generalizes: grep for other
   `Function.prototype.toString` / `.name`-dependent logic; drive `examples/demo` +
   `examples/ssr` through full production builds and click through every page (the gallery
   exists for exactly this).
6. **Sourcemaps & debuggability.** Does dist ship sourcemaps; do consumer stack traces
   point somewhere useful?

## Boundaries

- `src/data/` excluded from the audit; its entry's *packaging* (exports map mechanics) is
  in scope since it ships either way.
- No release, no version changes; `--dry-run` and `yarn pack` only (the RELEASING flow is
  the maintainer's).
- Bundle-size *optimization* is REV-06's; this lens establishes the measurement and files
  size surprises.

## Verify

- The `is.class` fix pinned against a minified fixture; the gallery `/counter` page works
  in a production build (`vp build` + `vp run ssr-demo#start`, driven by hand or test).
- The scratch-consumer resolution + tree-shake measurements committed as findings-note
  artifacts (commands + outputs, reproducible).
- `yarn ci` green after fixes.
