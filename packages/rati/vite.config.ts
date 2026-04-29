import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import babel from '@rolldown/plugin-babel';
import { analyzer } from 'vite-bundle-analyzer';

const debugBundleContent = false;

export default defineConfig({
    plugins: [
        react(),
        babel({ presets: [decoratorPreset({ version: '2023-11' })] }),
        debugBundleContent && analyzer(),
    ],
    build: {
        lib: {
            entry: 'src/main.ts',
            // the proper extensions will be added
            fileName: 'main',
            formats: ['es'],
        },
        rolldownOptions: {
            // make sure to externalize deps that shouldn't be bundled
            // into your library
            external: [],
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
