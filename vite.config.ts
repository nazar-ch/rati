import { fmt, lint, runTasks } from '@jnana-app/kit/vite';
import { staged } from '@jnana-app/kit/vite/staged';
import { defineConfig } from 'vite-plus';

// `**/dist/**` is emitted code, linted at the `.ts` it compiles from. Never a `*.config.*` entry:
// every config file here is this repo's own source (kit◊FND-122).
const lintIgnorePatterns = ['**/dist/**'];

// rati's deltas over the family's canonical lint and fmt tables in `@jnana-app/kit/vite`.
export default defineConfig({
    lint: lint({
        ignorePatterns: lintIgnorePatterns,
        // The whole repo is React (the framework package + both example apps).
        react: ['**/*.{ts,tsx}'],
        overrides: [
            {
                // oxlint applies overrides in order, so these win over the canonical ones.
                files: ['**/*.{ts,tsx}'],
                rules: {
                    // Off: tsgolint models no `noUncheckedIndexedAccess`, and its autofix strips the
                    // `arr[i]!` and generic assertions tsc needs.
                    'typescript/no-unnecessary-type-assertion': 'off',
                    // `island()` wraps a component the way `memo` does, so its result is one.
                    'react/only-export-components': ['error', { customHOCs: ['island'] }],
                },
            },
            {
                // The framework's departures from the canonical rule table, which the example apps
                // do not share.
                files: ['packages/rati/src/**'],
                rules: {
                    // Off: rati's type machinery uses `{}` on purpose — the param and fallback
                    // defaults, and the `RatiUserTypes {}` augmentation interface, which can't be
                    // `Record<string, never>`.
                    'typescript/no-empty-object-type': 'off',
                    // Off: `any` is a generic-constraint primitive here (`Scope<any>`,
                    // `(...args: any) => any`, `Prop<any>`) where `unknown` can't substitute.
                    'typescript/no-explicit-any': 'off',
                    // Off: the `!`s in rati's internals are array-index accesses on values present
                    // by construction (`buckets[index]!`).
                    'typescript/no-non-null-assertion': 'off',
                    // Off: it fires on the `any | Promise<any>` load unions and on
                    // `NameToRoute<UserRoutes> | string`, whose route side is `never` until an app
                    // augments `RatiUserTypes`.
                    'typescript/no-redundant-type-constituents': 'off',
                    // Off: a module exports its components beside the functions and hooks that
                    // build and read them, and an app loads the built package, which fast refresh
                    // never reaches.
                    'react/only-export-components': 'off',
                },
            },
            {
                // `rati/vite` runs in the Vite process, on Node.
                files: ['packages/rati/src/vite/**'],
                rules: {
                    'import/no-nodejs-modules': 'off',
                    // `vite` is the peer rati declares, and a consumer on plain Vite has no
                    // `vite-plus` to import.
                    'vite-plus/prefer-vite-plus-imports': 'off',
                },
                env: {
                    node: true,
                },
            },
        ],
    }),
    fmt: fmt({
        // GLOBS, never regexes: `*` crosses no `/`, so `react*` reaches `react-dom` and `react*/**`
        // reaches `react-dom/client`.
        sortImports: {
            // rati's suites import from `vite-plus/test` beside `vitest` itself.
            testRunners: ['vite-plus/test'],
            // The framework tier, in dependency order.
            frameworks: [
                ['react*', 'react*/**'],
                ['mobx*', 'mobx*/**'],
            ],
            // rati carries no `imports` subpath and no `paths` alias for the canonical `#`/`~`
            // groups to name.
            aliases: [],
        },
        // yarn rewrites `.yarnrc.yml` in its own style on every install.
        ignorePatterns: ['**/dist', '.yarnrc.yml'],
    }),
    run: {
        tasks: runTasks,
    },
    staged: staged(),
});
