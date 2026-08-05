import { fmt, lint, runTasks } from '@jnana-app/kit/vite';
import { staged } from '@jnana-app/kit/vite/staged';
import { defineConfig } from 'vite-plus';

// `**/dist/**`: built output. `packages/rati/dist` is git-ignored and rebuilt on demand
// (`.claude/kit.json`'s `prep` step puts it in every fresh slot, and `yarn ci build` in a release
// run), so it is emitted JavaScript and declarations, not source — every rule is already enforced
// against the `.ts` it was compiled from, and linting the emit would redden the gate on generated
// code nobody edits.
//
// NO `*.config.*` entry, deliberately (jnana-kit:FND-122). The five files that pattern matched here
// — the root `vite.config.ts`, `packages/rati/{vite,vitest}.config.ts` and the two examples' —
// are all this repo's OWN source, and none of them sits in any tsc program, so ignoring them left
// them unchecked by BOTH halves of the gate at once. Linting them is the half this repo can have
// today; the typecheck half wants a root program this item does not add (see the PR body).
//
// A named constant because it has TWO readers — the lint config below and the pre-commit lint task's
// filter, which drops what oxlint would ignore. Those were two hand-maintained lists until
// jnana-kit:FND-72, and one array is what keeps them from drifting apart again.
const lintIgnorePatterns = ['**/dist/**'];

// Toolchain config for the rati monorepo (lint = oxlint, fmt = oxfmt), on the family's canonical
// tables in `@jnana-app/kit/vite`. What is below is this repo's genuine deltas and nothing else —
// the rule table, the React fragment, the plugin list, the type-aware options, the formatting block
// and the two cacheable run tasks all live in the package now, with their rationale, so a change to
// any of them is one edit for five repos and not five.
//
// rati is a single published React + MobX framework package (`packages/rati`) plus two example apps
// (`examples/*`). Everything here is React, so the React fragment applies repo-wide rather than
// being scoped to a frontend dir.
export default defineConfig({
    lint: lint({
        ignorePatterns: lintIgnorePatterns,
        // The whole repo is React (the framework package + both example apps).
        react: ['**/*.{ts,tsx}'],
        overrides: [
            {
                // rati's five departures from the canonical rule table. Each is a framework-machinery
                // difference, not a relaxation of taste, and each appends rather than replaces —
                // oxlint applies overrides in order, so these win over the canonical entries above.
                files: ['**/*.{ts,tsx}'],
                rules: {
                    // `warn`, not canonical `error`: rati's type machinery uses the empty object type
                    // deliberately — `{}` param/fallback defaults and, notably, the `RatiUserTypes {}`
                    // declaration-merging augmentation interface (which can't be
                    // `Record<string, never>`). Kept visible without blocking.
                    'typescript/no-empty-object-type': 'warn',
                    // `warn`, not canonical `error`: rati is a generics-heavy framework and uses `any`
                    // as an intentional generic-constraint primitive (`Scope<any>`,
                    // `(...args: any) => any`, `Prop<any>`) where `unknown` can't substitute. Warn
                    // keeps a stray app-style `any` visible without flagging the machinery as errors.
                    'typescript/no-explicit-any': 'warn',
                    // `warn`, not canonical `error`: the `!`s in rati's internals are deliberate,
                    // commented array-index accesses on values known-present by construction
                    // (`buckets[index]!` etc.).
                    'typescript/no-non-null-assertion': 'warn',
                    // `warn`, not canonical `error`: same framework-machinery rationale as
                    // no-explicit-any — it fires on the deliberate `any | Promise<any>` load unions
                    // and on `NameToRoute<UserRoutes> | string`, where the route side is `never` until
                    // users augment `RatiUserTypes`. Kept visible, not blocking.
                    'typescript/no-redundant-type-constituents': 'warn',
                    // Off, not canonical `error`: tsgolint's necessity analysis disagrees with tsc
                    // (the authoritative type gate) on rati's code — it doesn't model
                    // `noUncheckedIndexedAccess` (so it strips `arr[i]!` the tests need) and flags
                    // load-bearing generic assertions (`scopeOption as Scope<any>`,
                    // `component as ComponentType<any>`) as redundant. Its autofix removes exactly
                    // those, breaking the typecheck, so this rule can't be `error`/`warn` here (warn
                    // still autofixes). tsc is the gate.
                    'typescript/no-unnecessary-type-assertion': 'off',
                },
            },
            {
                // MUST follow the block above, and exists only because of it. The canonical test
                // override turns `no-non-null-assertion` OFF in test trees, but it is applied before
                // anything a repo appends — so rati's repo-wide `warn` above would win there and
                // re-flag every idiomatic `map.get(id)!` in the suite — measured, `vp lint` goes
                // 26 → 324 `no-non-null-assertion` diagnostics with this entry removed. `!` is
                // idiomatic and low-risk in test code, so tests are not gated on it the way source
                // is. The glob list is rati's own tree shapes; the canonical override's wider list
                // (`**/test/**`, `tests/**`) matches nothing here.
                files: ['**/__tests__/**', '**/*.{test,spec}.{js,jsx,ts,tsx}', '**/*.test-d.ts'],
                rules: {
                    'typescript/no-non-null-assertion': 'off',
                },
            },
            {
                // `rati/vite` is the Vite plugin: it runs in the Vite process (Node, not browser) and
                // reads the app's template off disk.
                //
                // prefer-vite-plus-imports off: it rewrites `from 'vite'` to `'vite-plus'`, which is
                // right for app code in a Vite+ project and wrong for a published package — `vite` is
                // the peer rati declares, and a consumer on plain Vite has no `vite-plus` to import.
                files: ['packages/rati/src/vite/**'],
                rules: {
                    'import/no-nodejs-modules': 'off',
                    'vite-plus/prefer-vite-plus-imports': 'off',
                },
                env: {
                    node: true,
                },
            },
        ],
    }),
    fmt: fmt({
        importOrder: {
            // rati's suites import from `vite-plus/test` beside `vitest` itself.
            testRunners: ['^vite-plus/test'],
            // The framework tier, in dependency order: React first, then MobX.
            frameworks: [['^react'], ['^mobx']],
            // rati uses neither a package.json `imports` subpath nor a tsconfig `paths` alias
            // (measured: no `from '#…'` or `from '~…'` anywhere), so the canonical `^#`/`^~` groups
            // would claim an alias scheme this repo does not have.
            aliases: [],
        },
        // `**/dist`: built output — reformatting it is work the next build discards. `.yarnrc.yml`:
        // yarn owns and rewrites it in its own 2-space style, so formatting it just creates churn
        // (found by `scripts/ci.ts`'s fmt stage — the first thing to ever run `vp fmt --check`
        // repo-wide).
        //
        // The canonical list already carries `**/generated`, `**/*.md` and `.claude/kit.json`, so
        // this repo's copies of the last two are gone rather than restated.
        ignorePatterns: ['**/dist', '.yarnrc.yml'],
    }),
    run: {
        tasks: runTasks,
    },
    // The pre-commit task set (run by `vp staged` from `.vite-hooks/pre-commit`), canonical for the
    // family. Its two false-green invariants live with the code they constrain, in the package's
    // `vite/staged.ts`: the emitted key order that the kit's `tools/pre-commit-gate.sh` makes
    // meaningful with `--concurrent 1` (jnana-kit:FND-165), and the quoting a function task needs
    // because lint-staged re-parses its returned string whole (jnana-kit:FND-91). The package's
    // `staged.test.ts` pins both against the factory's output, so this repo inherits the same pins
    // instead of re-deriving them here.
    staged: staged({
        // The directory this config sits in IS the repo root, and the lint filter relativizes against
        // it — lint-staged hands tasks absolute paths, so a root-anchored ignore entry tested against
        // one can never match (jnana-kit:FND-72). `import.meta.dirname` rather than `process.cwd()`:
        // measured to survive the vite-plus config loader, and correct wherever a future caller's cwd
        // happens to be.
        root: import.meta.dirname,
        // A consumer: the scans are the kit's files, reached through its `bin/` and
        // `$JNANA_KIT_HOME` rather than by a repo-relative path.
        kitScripts: 'kit-home',
        // The same array the lint config above is built from, not a second copy of it:
        // jnana-kit:FND-72's defect was the copy, and passing the list is what makes the filter track
        // it.
        lintIgnorePatterns,
    }),
});
