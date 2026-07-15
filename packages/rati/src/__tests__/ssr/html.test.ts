import { describe, test, expect } from 'vite-plus/test';

import {
    DEFAULT_PLACEHOLDERS,
    fillTemplate,
    isWholeDocument,
    spliceDocument,
    type Assembler,
    type RenderedParts,
} from '../../ssr/html';

/*
    The HTML assembly both servers share. Pure string work, so it is tested here rather
    than through either of them — ratiSsr.test.ts and requestHandler.test.ts cover the
    wiring around it.
*/

function parts(overrides: Partial<RenderedParts> = {}): RenderedParts {
    return {
        html: '<h1>app</h1>',
        headTags: '<title>t</title>',
        stateScript: '<script id="s"></script>',
        ...overrides,
    };
}

/** Whoever is assembling — its identity is what the refusals below quote back. */
const BY: Assembler = {
    name: 'rati:ssr',
    template: 'index.html',
    option: 'ratiSsr({ placeholders })',
};

const TEMPLATE = [
    '<!doctype html>',
    '<html><head><!--app-head--></head>',
    '<body><div id="root"><!--app-html--></div><!--app-state--></body></html>',
].join('');

describe('fillTemplate', () => {
    test('places each part at its placeholder', () => {
        const html = fillTemplate(TEMPLATE, parts(), DEFAULT_PLACEHOLDERS, BY);

        expect(html).toBe(
            '<!doctype html><html><head><title>t</title></head>' +
                '<body><div id="root"><h1>app</h1></div><script id="s"></script></body></html>',
        );
    });

    test('keeps `$&` and friends in rendered markup verbatim', () => {
        // The bug a plain string replacement would have: String.replace reads these in
        // the *replacement* as capture references, so the price below would come out as
        // the placeholder text itself.
        const html = fillTemplate(
            TEMPLATE,
            parts({ html: `<p>$& and $' and $\` and $1</p>` }),
            DEFAULT_PLACEHOLDERS,
            BY,
        );

        expect(html).toContain(`<p>$& and $' and $\` and $1</p>`);
    });

    test('honours custom placeholder names', () => {
        const html = fillTemplate(
            '<head>{{head}}</head><body>{{app}}{{state}}</body>',
            parts(),
            { head: '{{head}}', html: '{{app}}', state: '{{state}}' },
            BY,
        );

        expect(html).toBe(
            '<head><title>t</title></head><body><h1>app</h1><script id="s"></script></body>',
        );
    });

    test('throws when a part has nowhere to go', () => {
        // The silent-loss case: without `<!--app-state-->` the page looks fine and
        // hydrates from scratch, so SSR quietly stops paying for itself.
        const noState = '<html><head><!--app-head--></head><body><!--app-html--></body></html>';

        expect(() => fillTemplate(noState, parts(), DEFAULT_PLACEHOLDERS, BY)).toThrow(
            /index\.html has no <!--app-state-->.*hydration payload/s,
        );
    });

    test('leaves an empty part alone, placeholder or not', () => {
        // An app with no head store declares nothing; that is not a broken template.
        const noHead = '<html><head></head><body><!--app-html--><!--app-state--></body></html>';

        expect(() =>
            fillTemplate(noHead, parts({ headTags: '' }), DEFAULT_PLACEHOLDERS, BY),
        ).not.toThrow();
    });
});

describe('isWholeDocument', () => {
    test.for([
        ['<!DOCTYPE html><html>…', true],
        ['<!doctype html><html>…', true],
        ['\n  <!doctype html>', true],
        ['<html lang="en">…', true],
        ['<html>', true],
        ['<div id="root">…</div>', false],
        ['<h1>app</h1>', false],
        ['', false],
    ] as const)('%s → %s', ([html, expected]) => {
        expect(isWholeDocument(html)).toBe(expected);
    });
});

describe('spliceDocument', () => {
    const DOCUMENT = '<!doctype html><html><head><meta /></head><body><div>app</div></body></html>';

    test('splices the head tags into <head> and the payload before </body>', () => {
        const html = spliceDocument(DOCUMENT, parts(), BY);

        expect(html).toBe(
            '<!doctype html><html><head><meta /><title>t</title></head>' +
                '<body><div>app</div><script id="s"></script></body></html>',
        );
    });

    test("splices before the document's own </body>, not a rendered one", () => {
        // A page rendering literal markup (dangerouslySetInnerHTML, an HTML sample)
        // carries a closing tag of its own — the payload belongs after it.
        const withSample = '<html><head></head><body><pre></body></pre>x</body></html>';

        const html = spliceDocument(withSample, parts({ headTags: '' }), BY);

        expect(html).toBe(
            '<html><head></head><body><pre></body></pre>x<script id="s"></script></body></html>',
        );
    });

    test('throws when the document has no </head> to splice into', () => {
        expect(() => spliceDocument('<html><body>x</body></html>', parts(), BY)).toThrow(
            /no <\/head>.*head tags/s,
        );
    });
});
