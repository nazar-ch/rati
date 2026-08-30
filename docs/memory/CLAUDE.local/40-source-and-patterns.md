## Source layout (`packages/rati/src`)

`main.ts` is the only public barrel; the subpath entries are `rati/data`, `rati/mobx`, `rati/ssr`, `rati/server`, `rati/vite`, `rati/testing` and `rati/debug`. Everything else — `mandala/` (the engine — "one engine, two faces"), `scope/`, `island/`, `router/`, `head/`, `util/`, `types/` — is internal, and the per-file map is docs/current/internals.md §Source layout.

## Key patterns

- **Reactivity = `useSyncExternalStore`.** Core is MobX-free: a `Source` is a `subscribe`/`getSnapshot` pair, the router is a plain external store, and components read both through uSES (no `observer`). Optional MobX bindings (`observableSource`) live in `rati/mobx`.
- **No stores container.** An app's store graph is app code behind its own context. The router is provided on its own (`createRouter` → `RouterProvider` → `useRouter`). The `Router` type is table-blind (typed off the `RatiUserTypes` augmentation), so app containers hold it without importing the route table.
- **No decorators anywhere** — the toolchain is pure oxc, with no Babel lowering in it, and `rati/data` models state as plain observable objects from factories.
- **`rati-dev` export condition** exposes `src/main.ts` so consumers (Jnana, the examples) type-check and bundle rati's *source* in dev — edits are picked up with no build. The published `import`/`types` conditions point at `dist/`.
- **Lint policy** (root `vite.config.ts`): the type-machinery rules — `no-explicit-any`, `no-non-null-assertion`, `no-empty-object-type`, `no-redundant-type-constituents` — are **`warn`**, because they fire on intentional generic constraints like `Scope<any>`, the `RatiUserTypes {}` augmentation interface and `arr[i]!`. `no-unnecessary-type-assertion` is **off** (see Restricted actions). Everything else is strict, and React rules apply repo-wide.
- Keep the *why* comments and the `console.*` you didn't write.

<!--r-->

- rati uses **relative imports** (no `#` path alias), and no barrel beyond `main.ts`. Every relative specifier carries an explicit `.js` extension — `./scope/scope.js`, a directory as `./data/index.js`.

evidence: tsc copies the specifier into the emitted `.d.ts` verbatim, so an extensionless one is unresolvable to a `nodenext` consumer (kit◊KC-42).

<!--/r-->
