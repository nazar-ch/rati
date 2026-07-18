import { defineConfig, lazyPlugins } from 'vite-plus';
import react from '@vitejs/plugin-react';

const conditions = ['rati-dev', 'import', 'module', 'browser', 'default'];

// https://vitejs.dev/config/
// Type-checking is handled by tsgo (`yarn typecheck` / the build script), not an
// in-dev plugin — vite-plugin-checker was dropped with the move off the `typescript`
// package onto tsgo.
export default defineConfig({
    plugins: lazyPlugins(() => [react()]),
    resolve: {
        conditions,
    },
});
