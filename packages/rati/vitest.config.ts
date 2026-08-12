import { defineKitConfig } from '@jnana-app/kit/vitest';

// The framework package's suite — the one runnable vitest project in this repo, aggregated by the
// root vitest.config.ts beside it.
//
// Through the kit's definer rather than a bare `defineConfig` (kit◊KC-13): the enforced block
// it spreads last is family policy a suite does not get to hold an opinion about — the reporter pair
// (verbose off a TTY, so a piped run prints each test's console), `maxWorkers: '50%'` so parallel
// worktree slots do not oversubscribe the machine into timeouts, and `execArgv: ['--no-webstorage']`
// so jsdom's `localStorage` is the only one in the worker (Node 25+ installs its own, and vitest's
// jsdom environment then declines to overwrite it). A leaf has to go through the definer for that
// last one specifically: an aggregator's `execArgv` does not reach a project's forked worker.
export default defineKitConfig(
    {
        test: {
            // `name` is what makes this a PROJECT rather than a config nothing can aggregate, and
            // the kit's check-vitest-configs step requires every tracked config to declare either
            // this or `projects`.
            name: 'rati',
            environmentOptions: {
                jsdom: {
                    // Without this, jsdom starts at about:blank and rejects any
                    // history.pushState/replaceState as cross-origin.
                    url: 'http://localhost/',
                },
            },
            include: ['src/__tests__/**/*.test.{ts,tsx}'],
            setupFiles: ['./vitest.setup.ts'],
            typecheck: {
                enabled: true,
                checker: 'tsc',
                include: ['src/__tests__/**/*.test-d.ts'],
                tsconfig: './tsconfig.test.json',
            },
        },
    },
    // `environment: 'jsdom'` comes from the role rather than being restated here.
    ['jsdom'],
);
