import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
    plugins: [react()],
    build: {
        manifest: true,
    },
    ssr: {
        // Bundle our own workspace package so Vite resolves its source files.
        // react/react-dom stay external — Node's CJS↔ESM interop loads them
        // natively, which the entry server consumes via `* as` namespace.
        noExternal: ['rati'],
    },
});
