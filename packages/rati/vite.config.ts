import { defineConfig, lazyPlugins } from 'vite-plus';
import react from '@vitejs/plugin-react';
import babel from '@rolldown/plugin-babel';
import { analyzer } from 'vite-bundle-analyzer';

const debugBundleContent = false;
const debugBundlePreserveModules = false;

const bundleWhitelist: string[] = [];

export default defineConfig({
    plugins: lazyPlugins(() => [
        react(),
        babel({ presets: [decoratorPreset({ version: '2023-11' })] }),
        debugBundleContent && analyzer(),
    ]),
    build: {
        emptyOutDir: true,
        lib: {
            // Two entries: the MobX-free core and the optional `rati/mobx` bindings.
            // Rolldown hoists the shared core modules into a common chunk, so
            // SourceSymbol (and friends) keep one identity across both.
            entry: { main: 'src/main.ts', 'mobx/main': 'src/mobx/main.ts' },
            // the proper extensions will be added
            fileName: (_format, entryName) => `${entryName}.js`,
            formats: ['es'],
        },
        rolldownOptions: {
            output: debugBundlePreserveModules
                ? {
                      preserveModules: true,
                      preserveModulesRoot: 'src',
                      entryFileNames: '[name].js',
                      chunkFileNames: '[name].js',
                  }
                : {},
            external: (id) => {
                // always bundle relative & absolute imports (your own source)
                if (id.startsWith('.') || id.startsWith('/')) return false;
                // bundle whitelisted packages (and their subpaths)
                if (bundleWhitelist.some((pkg) => id === pkg || id.startsWith(pkg + '/'))) {
                    return false;
                }
                // externalize everything else
                return true;
            },
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
