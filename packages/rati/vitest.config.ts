import { defineKitConfig } from '@jnana-app/kit/vitest';

// The framework package's suite, aggregated by the root vitest.config.ts. A leaf goes through the
// kit's definer: the worker `execArgv` it enforces never reaches a project from an aggregator.
export default defineKitConfig({
    test: {
        // `name` is what makes this a PROJECT rather than a config nothing can aggregate, and
        // the kit's check-vitest-configs step requires every tracked config to declare either
        // this or `projects`.
        name: 'rati',
        // Only the `fuzz` and `e2e` kinds' files read this, the `unit` and `dom` kinds setting
        // their own, and a rendering `fuzz` file has no other source of a document.
        environment: 'jsdom',
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
            tsconfig: './src/__tests__/tsconfig.json',
        },
    },
});
