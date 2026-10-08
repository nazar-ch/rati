import { defineKitConfig } from '@jnana-app/kit/vitest';

// The repo-root aggregator the battery's `test` step runs from: without it, vitest runs
// packages/rati's suites with its defaults — no jsdom, no setup file.
export default defineKitConfig({
    test: {
        // `projects` alone: an aggregator's `test` block never reaches a project's forked worker.
        // The config FILE, never its directory, which check-vitest-configs reads as a stale project.
        projects: ['packages/rati/vitest.config.ts'],
    },
});
