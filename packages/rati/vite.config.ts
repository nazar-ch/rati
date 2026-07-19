import { defineConfig, lazyPlugins } from 'vite-plus';
import react from '@vitejs/plugin-react';
import { analyzer } from 'vite-bundle-analyzer';

const debugBundleContent = false;
const debugBundlePreserveModules = false;

const bundleWhitelist: string[] = [];

export default defineConfig({
    plugins: lazyPlugins(() => [react(), debugBundleContent && analyzer()]),
    build: {
        emptyOutDir: true,
        lib: {
            // Entries: the MobX-free core, the optional `rati/mobx` bindings, the
            // MobX-shaped data primitives (`rati/data`), the server-facing `rati/ssr`
            // surface, the `rati/server` production handler, the `rati/vite` plugin,
            // the `rati/debug` tooling, and the `rati/testing` test utilities. Rolldown
            // hoists the shared core modules into a common chunk, so SourceSymbol (and
            // friends) keep one identity across all of them. `rati/vite` shares nothing
            // but the HTML assembly — it type-imports the rest of the contract.
            entry: {
                main: 'src/main.ts',
                'mobx/index': 'src/mobx/index.ts',
                'data/index': 'src/data/index.ts',
                'ssr/index': 'src/ssr/index.ts',
                'server/index': 'src/server/index.ts',
                'vite/index': 'src/vite/index.ts',
                'debug/index': 'src/debug/index.ts',
                'testing/index': 'src/testing/index.ts',
            },
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
