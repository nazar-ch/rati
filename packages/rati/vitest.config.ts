import { defineConfig } from 'vite-plus';
import babel from '@rolldown/plugin-babel';

export default defineConfig({
    plugins: [babel({ presets: [decoratorPreset({ version: '2023-11' })] })],
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
            checker: 'tsgo',
            include: ['src/__tests__/**/*.test-d.ts'],
            tsconfig: './tsconfig.test.json',
        },
    },
});

/*
Vite guide:

"Currently, the Oxc transformer does not support lowering native decorators 
as we are waiting for the specification to progress, see (oxc-project/oxc#9170)."
-- https://github.com/oxc-project/oxc/issues/9170
*/
function decoratorPreset(options: Record<string, unknown>) {
    return {
        preset: () => ({
            plugins: [['@babel/plugin-proposal-decorators', options]],
        }),
        rolldown: {
            // Only run this transform if the file contains a decorator.
            filter: {
                code: '@',
            },
        },
    };
}
