/*
    rati/vite — the Vite plugin, kept in its own entry because it runs in the Vite
    process, not the app: nothing here reaches the browser.

    It owns both sides of an SSR app's tooling, which is why neither is yours:

      - dev — `vite dev` is the whole story. The plugin renders every HTML request
        through the app's server entry, so there is no server to hand-roll and no
        dev/prod branch to keep honest.
      - build — one `vite build` produces `dist/client` (with the manifest) and
        `dist/server`, and `virtual:rati/assets` carries the hashed entry, its
        stylesheets and each lazy route's preload into the server bundle. No manifest
        is read in production, because none is left to read.

    ```ts
    // vite.config.ts
    import { ratiSsr } from 'rati/vite';
    export default defineConfig({ plugins: [react(), ratiSsr()] });
    ```

    ```ts
    // entry-server.tsx
    import * as assets from 'virtual:rati/assets';
    export const render = (url: string) => renderApp({ url, createApp, assets });
    ```

    The one thing it needs from the app is the Layer-1 contract: a server entry
    exporting `render(url): Promise<RenderAppResult>`. Types for the generated module
    come from `rati/vite/client`. See docs/public/ssr.md.
*/
export { ratiSsr, type RatiSsrOptions } from './ratiSsr';
