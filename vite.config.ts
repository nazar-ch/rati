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
                // rati's departures from the canonical rule table, each a framework-machinery
                // difference. oxlint applies overrides in order, so these win over the canonical ones.
                files: ['**/*.{ts,tsx}'],
                rules: {
                    // `warn`, not canonical `error`: rati's type machinery uses `{}` on purpose — the
                    // param and fallback defaults, and the `RatiUserTypes {}` augmentation interface,
                    // which can't be `Record<string, never>`.
                    'typescript/no-empty-object-type': 'warn',
                    // `warn`, not canonical `error`: `any` is a generic-constraint primitive here
                    // (`Scope<any>`, `(...args: any) => any`, `Prop<any>`) where `unknown` can't
                    // substitute.
                    'typescript/no-explicit-any': 'warn',
                    // `warn`, not canonical `error`: the `!`s in rati's internals are array-index
                    // accesses on values present by construction (`buckets[index]!`).
                    'typescript/no-non-null-assertion': 'warn',
                    // `warn`, not canonical `error`: it fires on the `any | Promise<any>` load unions
                    // and on `NameToRoute<UserRoutes> | string`, whose route side is `never` until an
                    // app augments `RatiUserTypes`.
                    'typescript/no-redundant-type-constituents': 'warn',
                    // Off: tsgolint models no `noUncheckedIndexedAccess`, and its autofix — which
                    // `warn` still runs — strips the `arr[i]!` and generic assertions tsc needs.
                    'typescript/no-unnecessary-type-assertion': 'off',
                },
            },
            {
                // MUST follow the block above: the canonical test override turns
                // `no-non-null-assertion` off before a repo's entries apply, so the repo-wide `warn`
                // otherwise wins in the test trees. The globs are rati's own test shapes.
                files: ['**/__tests__/**', '**/*.{test,spec}.{js,jsx,ts,tsx}', '**/*.test-d.ts'],
                rules: {
                    'typescript/no-non-null-assertion': 'off',
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
