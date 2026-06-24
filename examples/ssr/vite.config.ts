import { defineConfig, lazyPlugins } from 'vite-plus';
import react from '@vitejs/plugin-react';
import babel from '@rolldown/plugin-babel';

const conditions = ['rati-dev', 'import', 'module', 'browser', 'default'];

// Type-checking is handled by tsgo (`yarn typecheck`), not an in-dev plugin —
// vite-plugin-checker was dropped with the move off the `typescript` package onto tsgo.
export default defineConfig({
    // `lazyPlugins` returns `undefined` for non-Vite commands (it skips
    // instantiating the plugins then); `?? []` keeps the type a plain
    // `PluginOption[]` for this tsconfig's exactOptionalPropertyTypes.
    plugins:
        lazyPlugins(() => [
            react(),
            babel({ presets: [decoratorPreset({ version: '2023-11' })] }),
        ]) ?? [],
    build: {
        manifest: true,
    },
    ssr: {
        // Bundle our own workspace package so Vite resolves its source files.
        // react/react-dom stay external — Node's CJS↔ESM interop loads them
        // natively, which the entry server consumes via `* as` namespace.
        noExternal: ['rati'],
        resolve: { conditions },
    },
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
