import type { Manifest, ManifestChunk } from 'vite';

/*
    `virtual:rati/assets` — what the built client needs from the page, as a module the server
    entry imports. The plugin holds the manifest at build time and inlines the values, so a
    serverless function reads no manifest at runtime; in dev it is the source entry and no CSS.
*/

export const ASSETS_MODULE = 'virtual:rati/assets';
/** `\0` keeps other plugins (and Node) from treating the id as a file. */
export const RESOLVED_ASSETS_MODULE = '\0' + ASSETS_MODULE;

/** The `virtual:rati/assets` shape — `RenderAssets` in `rati/ssr`, generated. */
interface Assets {
    bootstrapModules: string[];
    styleTags: string;
    /** moduleId (a manifest key) → the tags that preload its chunk. */
    preloads: Record<string, string>;
}

export function devAssets(clientEntry: string): string {
    // Vite serves the entry and its CSS through the module graph, so there is nothing
    // to preload and no stylesheet to link: the one honest value is the entry itself.
    return generate({ bootstrapModules: [clientEntry], styleTags: '', preloads: {} });
}

export function buildAssets(manifest: Manifest, clientEntry: string, base: string): string {
    const entry = manifest[clientEntry];
    if (!entry) {
        throw new Error(
            `rati:ssr — the client manifest has no entry for ${clientEntry}, so the built ` +
                `page would load no JavaScript. Point ratiSsr({ clientEntry }) at the module ` +
                `your client build starts from.`,
        );
    }
    return generate({
        bootstrapModules: [url(base, entry.file)],
        styleTags: styleTags(collectCss(manifest, clientEntry), base),
        preloads: preloads(manifest, clientEntry, base),
    });
}

/**
 * The preload tags for every route module the client build split out: a `lazy()` chunk is
 * otherwise found one round trip late, after the entry runs. What the entry already brings
 * is left out.
 */
function preloads(manifest: Manifest, clientEntry: string, base: string): Record<string, string> {
    const loaded = new Set(collectJs(manifest, clientEntry));
    const linked = new Set(collectCss(manifest, clientEntry));
    const result: Record<string, string> = {};

    for (const [key, chunk] of Object.entries(manifest)) {
        // Only the split-out modules: a route bundled into the entry needs no preload
        // (it is already there), and assets are not modules.
        if (!chunk.isDynamicEntry) continue;
        const tags =
            collectJs(manifest, key)
                .filter((file) => !loaded.has(file))
                .map((file) => `<link rel="modulepreload" href="${url(base, file)}">`)
                .join('') +
            styleTags(
                collectCss(manifest, key).filter((file) => !linked.has(file)),
                base,
            );
        if (tags) result[key] = tags;
    }
    return result;
}

function generate(assets: Assets): string {
    // A frozen literal: everything is decided here, so the server bundle carries the values
    // rather than the manifest and the code to read it.
    return [
        `export const bootstrapModules = ${JSON.stringify(assets.bootstrapModules)};`,
        `export const styleTags = ${JSON.stringify(assets.styleTags)};`,
        `const preloads = ${JSON.stringify(assets.preloads)};`,
        `export function preloadTagsFor(moduleId) {`,
        `    return preloads[moduleId] ?? '';`,
        `}`,
        '',
    ].join('\n');
}

/**
 * The chunk plus everything it statically imports — the whole set the browser needs to
 * run it, which is what `modulepreload` is for. `dynamicImports` stay out: they are the
 * chunk's own later decision.
 */
function collectJs(manifest: Manifest, key: string): string[] {
    const files: string[] = [];
    walk(manifest, key, (chunk) => files.push(chunk.file));
    return files;
}

/** A chunk's stylesheets, including those of the chunks it imports. */
function collectCss(manifest: Manifest, key: string): string[] {
    const files = new Set<string>();
    walk(manifest, key, (chunk) => {
        for (const file of chunk.css ?? []) files.add(file);
    });
    return [...files];
}

/** The static-import closure of a manifest entry; `seen` also breaks import cycles. */
function walk(manifest: Manifest, key: string, visit: (chunk: ManifestChunk) => void): void {
    const seen = new Set<string>();
    const queue = [key];
    while (queue.length) {
        const current = queue.shift()!;
        if (seen.has(current)) continue;
        seen.add(current);
        const chunk = manifest[current];
        if (!chunk) continue;
        visit(chunk);
        queue.push(...(chunk.imports ?? []));
    }
}

function styleTags(files: string[], base: string): string {
    return files.map((file) => `<link rel="stylesheet" href="${url(base, file)}">`).join('');
}

/** Manifest files are relative to the client outDir; the page wants them under `base`. */
function url(base: string, file: string): string {
    return `${base.endsWith('/') ? base : base + '/'}${file}`;
}
