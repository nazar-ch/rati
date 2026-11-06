import react from '@vitejs/plugin-react';
import { defineConfig, lazyPlugins } from 'vite-plus';

const conditions = ['rati-dev', 'import', 'module', 'browser', 'default'];

export default defineConfig({
    // `?? []`: `lazyPlugins` returns `undefined` for a non-Vite command, which
    // `exactOptionalPropertyTypes` refuses here.
    plugins: lazyPlugins(() => [react()]) ?? [],
    resolve: {
        conditions,
    },
});
