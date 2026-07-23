import { defineConfig, lazyPlugins } from 'vite-plus';
import react from '@vitejs/plugin-react';

const conditions = ['rati-dev', 'import', 'module', 'browser', 'default'];

// https://vitejs.dev/config/
// Type-checking is handled by tsc (the native TS7 compiler, via `yarn typecheck` /
// the build script), not an in-dev plugin — vite-plugin-checker isn't used.
export default defineConfig({
    plugins: lazyPlugins(() => [react()]),
    resolve: {
        conditions,
    },
});
