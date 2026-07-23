/*
    A server entry that implements the Layer-1 contract by hand: canned results per URL.

    Deliberately not a real rati app. The plugin's job is mapping a `RenderAppResult`
    onto a response and assembling HTML around it — the contract is the whole coupling,
    so driving it directly tests exactly that, and keeps a dev-server test off React and
    off `renderApp` (which renderApp.test.tsx already covers).
*/
import type { RenderAppResult } from '../../../ssr/renderApp';

type Rendered = Extract<RenderAppResult, { kind: 'rendered' }>;

function rendered(html: string, extra: Partial<Omit<Rendered, 'kind' | 'html'>> = {}): Rendered {
    return {
        kind: 'rendered',
        html,
        status: 200,
        headTags: '<title>fixture</title>',
        stateScript: '<script type="application/json" id="__rati-hydration">{"v":1}</script>',
        hydration: { v: 1, data: {}, seeds: {} },
        errors: [],
        matchedCatchAll: false,
        ...extra,
    };
}

const RESULTS = new Map<string, RenderAppResult>([
    // `$&` and `$'` are capture references to String.replace — rendered markup carrying
    // them must survive assembly verbatim.
    ['/', rendered("<h1>home</h1><p>total: $&100 ($'each)</p>")],
    ['/missing', rendered('<h1>not found</h1>', { status: 404, matchedCatchAll: true })],
    ['/broken', rendered('<h1>loading…</h1>', { status: 500 })],
    [
        '/document',
        rendered(
            '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8" /></head>' +
                '<body><div id="root"><pre>&lt;/body&gt; in a sample</pre></div></body></html>',
        ),
    ],
    ['/no-head', rendered('<html lang="en"><body><p>headless</p></body></html>')],
    // A URL `decodeURIComponent` rejects. The router hands the raw segment through, so
    // the app renders an answer — one per assembly path, since both hand the URL on.
    ['/products/%zz', rendered('<h1>no such product</h1>', { status: 404, matchedCatchAll: true })],
    ['/products/%FF', rendered('<h1>no such product</h1>', { status: 404, matchedCatchAll: true })],
    ['/products/%2', rendered('<h1>no such product</h1>', { status: 404, matchedCatchAll: true })],
    ['/products/%', rendered('<h1>no such product</h1>', { status: 404, matchedCatchAll: true })],
    [
        '/document/%zz',
        rendered(
            '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8" /></head>' +
                '<body><div id="root"><h1>no such document</h1></div></body></html>',
            { status: 404, matchedCatchAll: true },
        ),
    ],
    ['/old', { kind: 'redirect', to: '/', permanent: true, status: 301 }],
    ['/temporary', { kind: 'redirect', to: '/', permanent: false, status: 302 }],
    ['/unrouted', { kind: 'no-match', status: 404 }],
]);

export function render(url: string): Promise<RenderAppResult> {
    if (url === '/boom') throw new Error('render exploded');
    const result = RESULTS.get(url);
    if (!result) throw new Error(`fixture has no result for ${url}`);
    return Promise.resolve(result);
}
