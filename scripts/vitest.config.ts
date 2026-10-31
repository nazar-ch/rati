import { defineKitConfig } from '@jnana-app/kit/vitest';

// rati's repo scripts, each suite beside the script it drives, aggregated by the root
// vitest.config.ts.
export default defineKitConfig(
    {
        test: {
            name: 'scripts',
            include: ['*.test.ts'],
        },
    },
    ['node'],
);
