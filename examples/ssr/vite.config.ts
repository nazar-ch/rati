import { defineConfig, lazyPlugins } from 'vite-plus';
import react from '@vitejs/plugin-react';
import { ratiSsr } from 'rati/vite';

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
            // The plugin is both halves of this app's tooling: `vp dev` renders every
            // request through src/entry-server.tsx (no dev server of its own), and
            // `vp build` builds src/entry-client.tsx → dist/client and the server entry
            // → dist/server in one command (no build scripts of its own, and no
            // manifest for the production server to find).
            ratiSsr(),
        ]) ?? [],
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
