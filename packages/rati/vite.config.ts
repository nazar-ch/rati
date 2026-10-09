import react from '@vitejs/plugin-react';
import { analyzer } from 'vite-bundle-analyzer';
import { defineConfig, lazyPlugins } from 'vite-plus';

const debugBundleContent = false;
const debugBundlePreserveModules = false;

const bundleWhitelist: string[] = [];

export default defineConfig({
    // `?? []`: `lazyPlugins` returns `undefined` for a non-Vite command, which
    // `exactOptionalPropertyTypes` refuses here.
    plugins: lazyPlugins(() => [react(), debugBundleContent && analyzer()]) ?? [],
    build: {
        emptyOutDir: true,
        lib: {
            // Rolldown hoists the shared core into a common chunk, so `SourceSymbol` keeps one
            // identity across every entry. `rati/vite` imports only the HTML assembly at runtime.
            entry: {
                main: 'src/main.ts',
                'mobx/index': 'src/mobx/index.ts',
                'data/index': 'src/data/index.ts',
                'ssr/index': 'src/ssr/index.ts',
                'server/index': 'src/server/index.ts',
                'vite/index': 'src/vite/index.ts',
                'debug/index': 'src/debug/index.ts',
                'testing/index': 'src/testing/index.ts',
                // Separate from `testing/index` so the main testing barrel stays
                // MobX-free (same boundary as `rati/data` vs `rati`).
                'testing/data/index': 'src/testing/data/index.ts',
            },
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
                if (id.startsWith('.') || id.startsWith('/')) return false;
                if (bundleWhitelist.some((pkg) => id === pkg || id.startsWith(pkg + '/'))) {
                    return false;
                }
                return true;
            },
        },
    },
});
