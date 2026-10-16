import { describe, test, expect } from 'vite-plus/test';

import { island } from '../../island/island.js';
import { scope, input } from '../../scope/scope.js';
import { renderToHtml } from '../../ssr/renderToHtml.js';

/*
    Every island is a Suspense boundary React can outline past its chunk budget, which
    renderToHtml's buffered render forbids; these pin the output shape. The shell wrapper is
    load-bearing: React never outlines the root segment, so a bare island stays inline at any
    size.
*/
const shellStyle = { padding: 8 };

/** Comfortably past React's default outlining budget. */
const bigRows = Array.from({ length: 350 }, (_, index) => `row ${index} — padded to weight`);

const BigIsland = island({
    scope: scope({ id: input<string>() }).load({
        rows: async ({ id }) => bigRows.map((row) => `${id}: ${row}`),
    }),
    component: ({ rows }) => (
        <ul>
            {rows.map((row) => (
                <li key={row}>{row}</li>
            ))}
        </ul>
    ),
    loading: () => <div>loading slot</div>,
});

describe('renderToHtml output shape', () => {
    test('a boundary past the default chunk budget still renders in place', async () => {
        const html = await renderToHtml(
            <div style={shellStyle}>
                <BigIsland id="big" />
            </div>,
        );

        expect(html.length).toBeGreaterThan(12_800);
        // Content between the boundary's own markers, inside the shell — in place.
        const inline = /<!--\$-->[\s\S]*<li>big: row 0[\s\S]*<li>big: row 349[\s\S]*<!--\/\$-->/;
        expect(html).toMatch(inline);
        // The outlining wire format: a `<div hidden id="S:0">` holding the content and
        // a script swapping it in over the loading slot, which would ship in its place.
        expect(html).not.toContain('id="S:');
        expect(html).not.toContain('hidden');
        expect(html).not.toContain('loading slot');
    });

    test('a small boundary is unaffected', async () => {
        const SmallIsland = island({
            scope: scope({ id: input<string>() }).load({ greeting: async ({ id }) => `hi ${id}` }),
            component: ({ greeting }) => <p>{greeting}</p>,
            loading: () => <div>loading slot</div>,
        });

        const html = await renderToHtml(
            <div style={shellStyle}>
                <SmallIsland id="small" />
            </div>,
        );

        expect(html).toContain('<!--$--><p>hi small</p><!--/$-->');
        expect(html).not.toContain('id="S:');
    });
});
