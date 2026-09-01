## Toolchain

Type-checking is **tsc** run from the workspace root as `yarn run -T tsc`, and lint/format config lives in the root `vite.config.ts` `lint`/`fmt` blocks. The pinned versions, the `.d.ts` emit and the lint deviations are docs/current/internals.md §Toolchain.

```bash
vp run rati#build         # vite lib bundle + tsc emits dist/*.d.ts
vp run rati#typecheck     # tsc --noEmit (src); rati#typecheck:test for the test tree
vp run rati#test          # Vitest (runtime + *.test-d.ts type tests via the tsc checker)
verify.ts                     # the gate
```

<!--r-->

**Never run `dprint fmt` yourself.** Reflow Markdown with `node node_modules/@jnana-app/kit/dist/checks/dprint-mangle-scan.js --fmt <file.md…>`, which the gate's own failure names as an absolute path.

evidence: a bare reflow bypasses the mangle scan, and dprint cannot see its own damage (kit◊FND-47). The bare `dprint-mangle-scan.ts` left `PATH` with kit◊KC-14, which is why the invocation is spelled out.

<!--/r-->

`**/*.md` is excluded from the `fmt` block: oxfmt corrupts snake_case next to emphasis, so dprint owns Markdown here as it does family-wide.
