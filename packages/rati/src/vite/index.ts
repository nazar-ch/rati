/*
    rati/vite — the Vite plugin, its own entry because it runs in the Vite process: `vite dev`
    renders every HTML request through the app's server entry, and one `vite build` builds both
    sides. Usage is docs/current/public/ssr.md.
*/
export { ratiSsr, type RatiSsrOptions } from './ratiSsr.js';
