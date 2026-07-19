import { defineConfig } from 'vite-plus';

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
        setupFiles: ['./vitest.setup.ts'],
        typecheck: {
            enabled: true,
            checker: 'tsgo',
            include: ['src/__tests__/**/*.test-d.ts'],
            tsconfig: './tsconfig.test.json',
        },
    },
});
