import { defineConfig } from 'vite-plus';

// Toolchain config for the rati monorepo (lint = oxlint, fmt = oxfmt), modelled on
// Jnana's setup but trimmed to rati's shape: a single published React + MobX framework
// package (`packages/rati`) plus two example apps (`examples/*`). Everything here is
// React, so the React rules apply repo-wide rather than being scoped to a frontend dir.
export default defineConfig({
    lint: {
        // Plugins MUST be enabled at this top level — oxlint does NOT activate a plugin
        // declared only inside an `overrides[].plugins`, so `import/*` (and friends) stay
        // silently inactive otherwise. (Learned the hard way in Jnana.)
        plugins: ['oxc', 'typescript', 'unicorn', 'react', 'import'],
        categories: {
            correctness: 'warn',
        },
        env: {
            builtin: true,
        },
        // `*.config.*`: vite/vitest config files aren't in any tsconfig `include`, so the
        // type-aware path would check them against the nearest tsconfig and surface noise
        // tsc never gates on. `**/dist/**`: built output.
        ignorePatterns: ['*.config.*', '**/dist/**'],
        overrides: [
            {
                files: ['**/*.{ts,tsx}'],
                rules: {
                    'constructor-super': 'error',
                    'for-direction': 'error',
                    'getter-return': 'error',
                    'no-async-promise-executor': 'error',
                    'no-case-declarations': 'error',
                    'no-class-assign': 'error',
                    'no-compare-neg-zero': 'error',
                    'no-cond-assign': 'error',
                    'no-const-assign': 'error',
                    'no-constant-binary-expression': 'error',
                    'no-constant-condition': 'error',
                    'no-control-regex': 'error',
                    'no-debugger': 'error',
                    'no-delete-var': 'error',
                    'no-dupe-class-members': 'error',
                    'no-dupe-else-if': 'error',
                    'no-dupe-keys': 'error',
                    'no-duplicate-case': 'error',
                    'no-empty': 'error',
                    'no-empty-character-class': 'error',
                    'no-empty-pattern': 'error',
                    'no-empty-static-block': 'error',
                    'no-ex-assign': 'error',
                    'no-extra-boolean-cast': 'error',
                    'no-fallthrough': 'error',
                    'no-func-assign': 'error',
                    'no-global-assign': 'error',
                    'no-import-assign': 'error',
                    'no-invalid-regexp': 'error',
                    'no-irregular-whitespace': 'error',
                    'no-loss-of-precision': 'error',
                    'no-misleading-character-class': 'error',
                    'no-new-native-nonconstructor': 'error',
                    'no-nonoctal-decimal-escape': 'error',
                    'no-obj-calls': 'error',
                    'no-prototype-builtins': 'error',
                    'no-redeclare': 'error',
                    'no-regex-spaces': 'error',
                    'no-self-assign': 'error',
                    'no-setter-return': 'error',
                    'no-shadow-restricted-names': 'error',
                    'no-sparse-arrays': 'error',
                    'no-this-before-super': 'error',
                    'no-unassigned-vars': 'error',
                    'no-undef': 'off',
                    'no-unexpected-multiline': 'error',
                    'no-unreachable': 'error',
                    'no-unsafe-finally': 'error',
                    'no-unsafe-negation': 'error',
                    'no-unsafe-optional-chaining': 'error',
                    'no-unused-labels': 'error',
                    'no-unused-private-class-members': 'error',
                    'no-unused-vars': 'off',
                    'no-useless-assignment': 'error',
                    'no-useless-backreference': 'error',
                    'no-useless-catch': 'error',
                    'no-useless-escape': 'error',
                    'no-with': 'error',
                    'preserve-caught-error': 'error',
                    'require-yield': 'error',
                    'use-isnan': 'error',
                    'valid-typeof': 'error',
                    'no-array-constructor': 'error',
                    'no-unused-expressions': 'error',
                    'import/no-cycle': 'error',
                    'import/no-self-import': 'error',
                    'import/no-duplicates': 'error',
                    'import/no-mutable-exports': 'error',
                    // Always `throw new Error(message)` — never a bare string, never an empty Error.
                    'unicorn/throw-new-error': 'error',
                    'unicorn/error-message': 'error',
                    // Import Node builtins with the `node:` protocol.
                    'unicorn/prefer-node-protocol': 'error',
                    // No accidental thenables; no `[...x]` where `x` is already iterable.
                    'unicorn/no-thenable': 'error',
                    'unicorn/no-useless-spread': 'error',
                    // rati is a browser framework that surfaces dev-time warnings through
                    // `console` deliberately; leaving the rule on also tempts autofixers to
                    // *delete* console statements. Relaxed in tests too (see below).
                    'no-console': 'off',
                    'prefer-const': 'error',
                    'no-var': 'error',
                    'typescript/ban-ts-comment': 'error',
                    'typescript/no-duplicate-enum-values': 'error',
                    // `warn`, not Jnana's `error`: rati's type machinery uses the empty object
                    // type deliberately — `{}` param/fallback defaults and, notably, the
                    // `RatiUserTypes {}` declaration-merging augmentation interface (which can't
                    // be `Record<string, never>`). Kept visible without blocking.
                    'typescript/no-empty-object-type': 'warn',
                    // `warn`, not Jnana's `error`: rati is a generics-heavy framework and uses
                    // `any` as an intentional generic-constraint primitive (`Scope<any>`,
                    // `(...args: any) => any`, `Prop<any>`) where `unknown` can't substitute. Warn
                    // keeps a stray app-style `any` visible without flagging the machinery as errors.
                    'typescript/no-explicit-any': 'warn',
                    'typescript/no-extra-non-null-assertion': 'error',
                    // `warn`, not Jnana's `error`: the `!`s in rati's internals are deliberate,
                    // commented array-index accesses on values known-present by construction
                    // (`buckets[index]!` etc.). Off entirely in test trees (idiomatic there).
                    'typescript/no-non-null-assertion': 'warn',
                    'typescript/no-misused-new': 'error',
                    'typescript/no-namespace': 'error',
                    'typescript/no-non-null-asserted-optional-chain': 'error',
                    'typescript/no-require-imports': 'error',
                    'typescript/no-this-alias': 'error',
                    'typescript/no-unnecessary-type-constraint': 'error',
                    'typescript/no-unsafe-declaration-merging': 'error',
                    'typescript/no-unsafe-function-type': 'error',
                    'typescript/no-wrapper-object-types': 'error',
                    'typescript/prefer-as-const': 'error',
                    'typescript/prefer-namespace-keyword': 'error',
                    'typescript/triple-slash-reference': 'error',
                    'typescript/explicit-function-return-type': 'off',
                    'typescript/explicit-module-boundary-types': 'off',
                    'typescript/consistent-type-imports': [
                        'error',
                        {
                            prefer: 'type-imports',
                            fixStyle: 'inline-type-imports',
                        },
                    ],
                    'typescript/array-type': [
                        'off',
                        {
                            default: 'array',
                        },
                    ],
                    'typescript/no-inferrable-types': 'off',
                    // Type-aware correctness (tsgolint). Promise-safety enforced everywhere:
                    // a floated/misused promise is a silent bug in the browser, so mark
                    // intentional fire-and-forget with `void` (or a real `.catch`) and wrap
                    // async event handlers as `() => void handler()`.
                    'typescript/no-floating-promises': 'error',
                    'typescript/no-misused-promises': 'error',
                    'typescript/await-thenable': 'error',
                    // `return await` inside try/catch (correct stack traces + catch semantics) and
                    // no spreading a non-spreadable (Promise, etc.).
                    'typescript/return-await': 'error',
                    'typescript/no-misused-spread': 'error',
                    // Reject promises with Errors, keep `+` operands same-typed, drop `=== true`.
                    'typescript/prefer-promise-reject-errors': 'error',
                    'typescript/restrict-plus-operands': 'error',
                    'typescript/no-unnecessary-boolean-literal-compare': 'error',
                    // `warn`, not Jnana's `error`: same framework-machinery rationale as
                    // no-explicit-any — it fires on the deliberate `any | Promise<any>` load
                    // unions and on `NameToRoute<UserRoutes> | string`, where the route side is
                    // `never` until users augment `RatiUserTypes`. Kept visible, not blocking.
                    'typescript/no-redundant-type-constituents': 'warn',
                    // Keep values out of templates / String() unless they stringify meaningfully.
                    'typescript/restrict-template-expressions': 'error',
                    'typescript/no-base-to-string': 'error',
                    // Off: tsgolint's necessity analysis disagrees with tsc (the authoritative
                    // type gate) on rati's code — it doesn't model `noUncheckedIndexedAccess`
                    // (so it strips `arr[i]!` the tests need) and flags load-bearing generic
                    // assertions (`scopeOption as Scope<any>`, `component as ComponentType<any>`)
                    // as redundant. Its autofix removes exactly those, breaking the typecheck, so
                    // this rule can't be `error`/`warn` here (warn still autofixes). tsc is the gate.
                    'typescript/no-unnecessary-type-assertion': 'off',
                    // Catch-callback variables are `unknown`, not implicit `any`.
                    'typescript/use-unknown-in-catch-callback-variable': 'error',
                    // Still triaging at `warn` before promoting.
                    'typescript/no-unnecessary-condition': 'warn',
                    // Flag usage of `/** @deprecated */`-tagged symbols (advisory, not a
                    // correctness bug) — `warn` reports without blocking while migrating off them.
                    'typescript/no-deprecated': 'warn',
                    // Off: no MobX awareness — it flags `store.method` references that are
                    // safe because the method is bound via `@action.bound` (or an action
                    // arrow field), which this rule can't see. rati is MobX-first, so keep off.
                    'typescript/unbound-method': 'off',
                },
                plugins: ['import'],
            },
            {
                // The whole repo is React (the framework package + both example apps), so the
                // React rules apply everywhere rather than being scoped to a frontend dir.
                files: ['**/*.{ts,tsx}'],
                rules: {
                    'react/display-name': 'error',
                    'react/jsx-key': 'error',
                    'react/jsx-no-comment-textnodes': 'error',
                    'react/jsx-no-duplicate-props': 'error',
                    'react/jsx-no-target-blank': 'error',
                    'react/jsx-no-undef': 'error',
                    'react/no-children-prop': 'error',
                    'react/no-danger-with-children': 'error',
                    'react/no-direct-mutation-state': 'error',
                    'react/no-find-dom-node': 'error',
                    'react/no-is-mounted': 'error',
                    'react/no-render-return-value': 'error',
                    'react/no-string-refs': 'error',
                    'react/no-unescaped-entities': 'error',
                    'react/no-unknown-property': 'error',
                    'react/no-unsafe': 'off',
                    'react/react-in-jsx-scope': 'off',
                    'react/require-render-return': 'error',
                    'react/jsx-filename-extension': [
                        'error',
                        {
                            extensions: ['.jsx', '.tsx'],
                        },
                    ],
                    'react/jsx-props-no-spreading': 'off',
                    'react/jsx-curly-brace-presence': [
                        'error',
                        {
                            props: 'never',
                            children: 'never',
                        },
                    ],
                    'react/self-closing-comp': 'error',
                    'react/rules-of-hooks': 'error',
                    'react/exhaustive-deps': 'warn',
                    'react/only-export-components': 'warn',
                },
                globals: {
                    React: 'writable',
                },
                env: {
                    browser: true,
                },
            },
            {
                // The SSR example server is Node, not browser.
                files: ['examples/ssr/server.ts', '**/server.ts'],
                rules: {
                    'import/no-nodejs-modules': 'off',
                },
                env: {
                    node: true,
                },
            },
            {
                // `rati/vite` is the Vite plugin: it runs in the Vite process (Node, not
                // browser) and reads the app's template off disk.
                //
                // prefer-vite-plus-imports off: it rewrites `from 'vite'` to
                // `'vite-plus'`, which is right for app code in a Vite+ project and wrong
                // for a published package — `vite` is the peer rati declares, and a
                // consumer on plain Vite has no `vite-plus` to import. The import is
                // type-only either way, so nothing is bundled.
                files: ['packages/rati/src/vite/**'],
                rules: {
                    'import/no-nodejs-modules': 'off',
                    'vite-plus/prefer-vite-plus-imports': 'off',
                },
                env: {
                    node: true,
                },
            },
            {
                // Test code: `!` is idiomatic (map.get(id)!, result!.x on values known-present
                // by construction) and low-risk, so don't gate tests on no-non-null-assertion the
                // way source is. Covers the co-located test tree (src/__tests__) and any
                // *.test/*.spec/*.test-d files.
                files: ['**/__tests__/**', '**/*.{test,spec}.{js,jsx,ts,tsx}', '**/*.test-d.ts'],
                rules: {
                    'typescript/no-non-null-assertion': 'off',
                    'no-console': 'warn',
                },
            },
        ],
        options: {
            // Type-aware lint RULES (no-misused-promises, no-floating-promises, …) — keep on.
            typeAware: true,
            // Type-CHECKING stays in tsc, not the linter. The linter type-checks every file it
            // touches against the nearest tsconfig, which pulls in files the curated per-package
            // tsconfig programs deliberately exclude and surfaces noise tsc never gates on. The
            // per-package `typecheck` scripts (tsc) remain the authoritative type gate.
            typeCheck: false,
        },
        jsPlugins: [
            {
                name: 'vite-plus',
                specifier: 'vite-plus/oxlint-plugin',
            },
        ],
        rules: {
            'vite-plus/prefer-vite-plus-imports': 'error',
        },
    },
    fmt: {
        printWidth: 100,
        singleQuote: true,
        tabWidth: 4,
        importOrder: [
            '^vitest$',
            '^vite-plus/test',
            '',
            '^react',
            '^mobx',
            '',
            '<BUILTIN_MODULES>',
            '',
            '<THIRD_PARTY_MODULES>',
            '',
            '^./',
            '',
            '^../',
        ],
        importOrderParserPlugins: ['typescript', 'jsx', 'decorators', 'decoratorAutoAccessors'],
        importOrderTypeScriptVersion: '5.7.0',
        importOrderCaseSensitive: false,
        importOrderSideEffects: false,
        sortPackageJson: true,
        // `**/*.md`: oxfmt's Markdown formatter corrupts literal text — it normalizes italic
        // `*word*` → `_word_`, and on a line mixing an un-backticked snake_case identifier with
        // underscore emphasis it mis-parses the delimiters (rewriting the literal underscore to
        // `*`). rati's docs use snake_case, so don't format Markdown at all. `**/dist`: built
        // output. (Same caveat documented in Jnana.) `.yarnrc.yml`: yarn owns and rewrites it
        // in its own 2-space style, so formatting it just creates churn (found by the
        // `scripts/ci.ts` fmt stage — the first thing to ever run `vp fmt --check` repo-wide).
        // `.claude/kit.json`: the jnana-kit manifest is JSONC (comments + trailing commas), and
        // oxfmt reads it as strict JSON and strips both — which breaks the manifest.
        ignorePatterns: ['**/dist', '**/*.md', '.yarnrc.yml', '.claude/kit.json'],
    },
    staged: {
        // Pre-commit gate (run by `vp staged` from .vite-hooks/pre-commit). Type-aware lint
        // RULES run here (config `typeAware`), but type-CHECKING does not (`typeCheck: false`) —
        // tsc owns that.
        //
        // THE ORDER OF THESE ENTRIES IS LOAD-BEARING, and the kit's `tools/pre-commit-gate.sh`
        // is what makes it hold: it spawns `vp staged --concurrent 1`, so the tasks run one at
        // a time in the order written here (jnana-kit:FND-165). Left alone, lint-staged runs the
        // tasks for DIFFERENT globs concurrently — `concurrent` defaults to `true` and becomes
        // `Infinity` for the glob-level list, and the `concurrent: false` a reader finds nearby
        // in its source governs only the sub-tasks WITHIN one glob, which is the trap. Two
        // invariants ride it: the MUTATING fmt task precedes the `'*'` control-byte scan (so the
        // scan measures the bytes actually being committed, not a pre-image fmt is midway
        // through replacing), and `vp fmt` precedes `vp lint` over the same file. Reordering
        // these keys silently reopens both.

        // FORMAT — one task, one command, over everything oxfmt formats. `.md` is absent: oxfmt
        // corrupts Markdown, so `fmt.ignorePatterns` excludes it.
        //
        // A BARE STRING, deliberately: lint-staged appends the staged paths itself as literal
        // argv entries, which makes this space-safe BY CONSTRUCTION. As a function it was not —
        // the returned string is re-parsed WHOLE (jnana-kit:FND-91), so a staged path containing
        // a space became two operands and `vp fmt` silently matched 0 files.
        //
        // `--no-error-on-unmatched-pattern` replaces the hand-rolled `.claude/kit.json` filter
        // this task used to carry. That manifest is JSONC and fmt-excluded (see
        // `fmt.ignorePatterns`), and handing `vp fmt` only excluded files exits 2 — measured —
        // which aborted the commit. The flag makes that a clean no-op for EVERY ignore entry
        // rather than the one that had been noticed, so `fmt.ignorePatterns` stays the single
        // source of truth and there is no second list here to drift from it.
        '*.{ts,tsx,js,jsx,mjs,cjs,mts,cts,json,html,css,scss,less,yml,yaml}':
            'vp fmt --no-error-on-unmatched-pattern',

        // LINT — the lintable subset only; oxlint has no rules for JSON/CSS/YAML, which is why
        // the fmt glob above is the wider of the two. A function (not a bare command) so it can
        // drop files oxlint ignores (`*.config.*`): handing `vp lint` only ignored paths makes it
        // exit 1 with "No files found to lint", which would break config-only commits — so an
        // all-ignored batch returns NO command rather than a no-op one.
        //
        // The interpolation is QUOTED, which the fmt task above does not need (jnana-kit:FND-91):
        // a function task's returned string is re-parsed whole, so an unquoted path containing a
        // space becomes two argv tokens and `vp lint` — which has no
        // `--no-error-on-unmatched-pattern` — aborts the commit naming nothing an author would
        // connect to a space in a filename.
        '*.{ts,tsx,js,jsx,mjs,cjs,mts,cts}': (files) => {
            const lintable = files.filter((file) => !/\.config\./.test(file));
            if (lintable.length === 0) return [];
            return `vp lint ${lintable.map((file) => `"${file}"`).join(' ')}`;
        },

        // Raw-control-byte gate. This repo is why it is not theoretical: four raw NULs sat in
        // `hydrationDiagnostics.ts` as a composite-key separator, which made git treat the file
        // as BINARY (diffs read `Bin 3467 bytes`, never content) and made ripgrep skip it
        // outright — so it was invisible to every rg-based sweep here until this gate was added.
        // `'*'` because the byte class is not a property of a language: a NUL in a `.json`
        // fixture hides that file exactly as it would in a `.ts`. The script drops binary
        // extensions itself and scans only what is staged.
        //
        // Unlike its neighbours it FAILS rather than fixes, and deliberately has no fixing mode:
        // rewriting a byte inside a string literal is a semantic edit — a raw 0x00 and `\x00` are
        // the same value in a TS template but NOT inside a regex class or a fixture asserting on
        // bytes — so the one safe automatic action is to stop and name the file:line:column.
        //
        // The script is the kit's (jnana-kit:FND-132 taught it to root in the INVOKING repo, not
        // its own checkout). `$JNANA_KIT_HOME` is the one carrier for that path and has no
        // sanctioned default, and it is interpolated HERE rather than left in the string because
        // lint-staged spawns a command without a shell — an unexpanded `$VAR` would reach bash as
        // a literal path and read as "no such file", a broken gate wearing a broken-looking
        // error. Unset is therefore its own named failure: no scan is not the same as a clean
        // scan. Both interpolations are quoted, per the lint task above.
        '*': (files) => {
            const kit = process.env['JNANA_KIT_HOME'];
            if (kit === undefined || kit === '') {
                return 'sh -c "echo pre-commit: JNANA_KIT_HOME is unset, so the control-byte gate did not run >&2; exit 1"';
            }
            const scan = `"${kit}/tools/ci-control-char-scan.sh"`;
            return `bash ${scan} ${files.map((file) => `"${file}"`).join(' ')}`;
        },
    },
});
