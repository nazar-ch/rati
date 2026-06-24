import { defineConfig, lazyPlugins } from 'vite-plus';
import react from '@vitejs/plugin-react';
import babel from '@rolldown/plugin-babel';

const conditions = ['rati-dev', 'import', 'module', 'browser', 'default'];

// https://vitejs.dev/config/
// Type-checking is handled by tsgo (`yarn typecheck` / the build script), not an
// in-dev plugin — vite-plugin-checker was dropped with the move off the `typescript`
// package onto tsgo.
export default defineConfig({
    plugins: lazyPlugins(() => [
        react(),
        babel({ presets: [decoratorPreset({ version: '2023-11' })] }),
    ]),
    resolve: {
        conditions,
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
