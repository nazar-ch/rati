/*
    rati/vite — the Vite plugin, kept in its own entry because it runs in the Vite
    process, not the app: nothing here reaches the browser.

    Today it owns dev serving. `vite dev` becomes the whole dev story for an SSR app —
    the plugin renders every HTML request through the app's server entry, so there is no
    server to hand-roll and no dev/prod branch to keep honest.

    ```ts
    // vite.config.ts
    import { ratiSsr } from 'rati/vite';
    export default defineConfig({ plugins: [react(), ratiSsr()] });
    ```

    The one thing it needs from the app is the Layer-1 contract: a server entry
    exporting `render(url): Promise<RenderAppResult>`. See docs/public/ssr.md.
*/
export { ratiSsr, type RatiSsrOptions } from './ratiSsr';
