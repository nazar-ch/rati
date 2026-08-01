// @vitest-environment node
import { describe, test, expect } from 'vite-plus/test';

import type { Manifest } from 'vite-plus';

import { buildAssets, devAssets } from '../../vite/assets';

/*
    The generated `virtual:rati/assets`, read back by running it. The module is code the
    server bundle inlines, so what matters is the values a server entry ends up handing
    to `renderApp` — not the source that carries them.
*/

async function evaluate(code: string): Promise<{
    bootstrapModules: string[];
    styleTags: string;
    preloadTagsFor: (moduleId: string) => string;
}> {
    return (await import(
        `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
    )) as never;
}

/*
    An entry with CSS, and one route split out with CSS of its own. The route imports
    two chunks: one it shares with the entry, one only it has — the shape that decides
    what a preload should and shouldn't repeat.
*/
const MANIFEST: Manifest = {
    'src/entry-client.tsx': {
        file: 'assets/entry-client-aaa.js',
        src: 'src/entry-client.tsx',
        isEntry: true,
        css: ['assets/entry-client-sss.css'],
        imports: ['_shared-zzz.js'],
        dynamicImports: ['src/pages/Settings.tsx'],
    },
    'src/pages/Settings.tsx': {
        file: 'assets/Settings-bbb.js',
        src: 'src/pages/Settings.tsx',
        isDynamicEntry: true,
        css: ['assets/Settings-ccc.css'],
        imports: ['_shared-zzz.js', '_route-only-yyy.js'],
    },
    '_shared-zzz.js': {
        file: 'assets/shared-zzz.js',
        css: ['assets/shared-ddd.css'],
    },
    '_route-only-yyy.js': {
        file: 'assets/route-only-yyy.js',
        css: ['assets/route-only-eee.css'],
    },
};

describe('dev', () => {
    test('names the source client entry and nothing else', async () => {
        // Vite serves the entry and its CSS through the module graph, so a hash or a
        // stylesheet link here would be a lie.
        const assets = await evaluate(devAssets('/src/entry-client.tsx'));

        expect(assets.bootstrapModules).toEqual(['/src/entry-client.tsx']);
        expect(assets.styleTags).toBe('');
        expect(assets.preloadTagsFor('src/pages/Settings.tsx')).toBe('');
    });
});

describe('build', () => {
    test('names the hashed entry and links its CSS', async () => {
        const assets = await evaluate(buildAssets(MANIFEST, 'src/entry-client.tsx', '/'));

        expect(assets.bootstrapModules).toEqual(['/assets/entry-client-aaa.js']);
        expect(assets.styleTags).toContain(
            '<link rel="stylesheet" href="/assets/entry-client-sss.css">',
        );
    });

    test("links the CSS of the entry's imports too", async () => {
        // A stylesheet the entry pulls in through a shared chunk is as much the page's
        // as its own — missing it is a flash of unstyled content.
        const assets = await evaluate(buildAssets(MANIFEST, 'src/entry-client.tsx', '/'));

        expect(assets.styleTags).toContain('href="/assets/shared-ddd.css"');
    });

    test('preloads a route chunk and everything it needs to run', async () => {
        // Not just the chunk: a route that arrives without the chunks it imports is
        // still one round trip from rendering.
        const tags = (
            await evaluate(buildAssets(MANIFEST, 'src/entry-client.tsx', '/'))
        ).preloadTagsFor('src/pages/Settings.tsx');

        expect(tags).toContain('<link rel="modulepreload" href="/assets/Settings-bbb.js">');
        expect(tags).toContain('<link rel="modulepreload" href="/assets/route-only-yyy.js">');
        expect(tags).toContain('<link rel="stylesheet" href="/assets/Settings-ccc.css">');
        expect(tags).toContain('<link rel="stylesheet" href="/assets/route-only-eee.css">');
    });

    test('leaves what the entry already brings out of a route preload', async () => {
        // The shared chunk and its CSS reach the route, but the page loads them either
        // way — bootstrapModules pulls the one, styleTags links the other. Preloading
        // them again is bytes spent to say nothing.
        const tags = (
            await evaluate(buildAssets(MANIFEST, 'src/entry-client.tsx', '/'))
        ).preloadTagsFor('src/pages/Settings.tsx');

        expect(tags).not.toContain('shared-zzz.js');
        expect(tags).not.toContain('shared-ddd.css');
        expect(tags).not.toContain('entry-client-aaa.js');
    });

    test('has nothing to say about a module the build did not split out', async () => {
        const assets = await evaluate(buildAssets(MANIFEST, 'src/entry-client.tsx', '/'));

        expect(assets.preloadTagsFor('src/pages/Home.tsx')).toBe('');
    });

    test('puts every url under base', async () => {
        const assets = await evaluate(buildAssets(MANIFEST, 'src/entry-client.tsx', '/app/'));

        expect(assets.bootstrapModules).toEqual(['/app/assets/entry-client-aaa.js']);
        expect(assets.styleTags).toContain('href="/app/assets/entry-client-sss.css"');
        expect(assets.preloadTagsFor('src/pages/Settings.tsx')).toContain(
            'href="/app/assets/Settings-bbb.js"',
        );
    });

    test('names the client entry when the manifest has no such key', () => {
        // The failure a wrong `clientEntry` option makes: a page that loads no
        // JavaScript at all, which otherwise looks like a hydration bug.
        expect(() => buildAssets(MANIFEST, 'src/main.tsx', '/')).toThrow(/no entry for src\/main/);
    });
});
