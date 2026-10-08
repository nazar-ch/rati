import react from '@vitejs/plugin-react';
import { ratiSsr } from 'rati/vite';
import { defineConfig, lazyPlugins } from 'vite-plus';

const conditions = ['rati-dev', 'import', 'module', 'browser', 'default'];

export default defineConfig({
    // `?? []`: `lazyPlugins` returns `undefined` for a non-Vite command, which
    // `exactOptionalPropertyTypes` refuses here.
    plugins:
        lazyPlugins(() => [
            react(),
            // Both halves of this app's tooling: `vp dev` renders every request through
            // src/entry-server.tsx, and `vp build` builds the client and server entries in
            // one command.
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
