import react from '@vitejs/plugin-react';
import { defineConfig, lazyPlugins } from 'vite-plus';

const conditions = ['rati-dev', 'import', 'module', 'browser', 'default'];

// https://vitejs.dev/config/
// Type-checking is handled by tsc (the native TS7 compiler, via `yarn typecheck` /
// the build script), not an in-dev plugin — vite-plugin-checker isn't used.
export default defineConfig({
    // `lazyPlugins` returns `undefined` for non-Vite commands (it skips instantiating the plugins
    // then); `?? []` keeps the type a plain `PluginOption[]` for the root config program's
    // `exactOptionalPropertyTypes`. The ssr example beside this one has carried the same spelling
    // all along; this file only needed it once a program started reading it (jnana-kit:FND-170 §C5).
    plugins: lazyPlugins(() => [react()]) ?? [],
    resolve: {
        conditions,
    },
});
