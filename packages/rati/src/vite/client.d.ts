/*
    Types for the modules `rati/vite` generates. An app pulls them in the way it pulls
    Vite's own — from its env.d.ts:

    ```ts
    /// <reference types="rati/vite/client" />
    ```
*/

declare module 'virtual:rati/assets' {
    /**
     * The client entry, hashed in a build and the source path in dev. Hand it to
     * `renderApp` (as part of `assets`) and React emits the `<script type="module">`,
     * so the HTML shell carries none itself.
     */
    export const bootstrapModules: string[];
    /**
     * `<link rel="stylesheet">` tags for the client entry's CSS — empty in dev, where
     * Vite injects styles through JS.
     */
    export const styleTags: string;
    /**
     * The tags that preload a route module's chunk — `renderApp` calls this with the
     * matched route's `moduleId`. Empty for anything the build didn't split out.
     */
    export function preloadTagsFor(moduleId: string): string;
}
