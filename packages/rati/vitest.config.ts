import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        environment: 'jsdom',
        environmentOptions: {
            jsdom: {
                // Without this, jsdom starts at about:blank and rejects any
                // history.pushState/replaceState as cross-origin.
                url: 'http://localhost/',
            },
        },
        include: ['src/__tests__/**/*.test.{ts,tsx}'],
        typecheck: {
            enabled: true,
            include: ['src/__tests__/**/*.test-d.ts'],
            tsconfig: './tsconfig.test.json',
        },
    },
});
