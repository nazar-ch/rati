import { defineKitConfig } from '@jnana-app/kit/vitest';

// The repo-root aggregator, and the reason the standard battery's `test` step means anything here
// (kit◊KC-13). That step is a plain `vp test --run` from the repo root, and without this file
// vitest resolved no project config at all: it collected packages/rati's suites off its own default
// glob and ran them with vitest's defaults — no jsdom environment, no setup file — which is 340 of
// 687 tests failing on `document is not defined`. A red that loud is survivable; the same shape with
// a suite that happens not to touch the DOM is a green that measured the wrong thing.
//
// `projects` is the whole content. Every project setting belongs to the project's own config
// (packages/rati/vitest.config.ts), because an aggregator's `test` block does not reach a project's
// forked worker — the two configs are peers, not a base and an override.
export default defineKitConfig({
    test: {
        // The config FILE, not its directory: vitest resolves either, but the kit's
        // check-vitest-configs step matches a listed project against the tracked config paths it
        // loaded, so a directory entry reads to it as an aggregator naming a project that is not
        // there — the exact stale-leaf case that check exists to catch.
        projects: ['packages/rati/vitest.config.ts'],
    },
});
