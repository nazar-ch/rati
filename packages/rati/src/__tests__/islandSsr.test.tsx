import { describe, test, expect } from 'vitest';
import { prerender } from 'react-dom/static';
import type { ReactElement } from 'react';
import { createView, viewParam } from '../common/view';
import { SourceSymbol, type Source } from '../common/source';
import { createIsland } from '../experimental/island';

// Drive react-dom/static `prerender` (which awaits all Suspense before producing
// HTML) to a string — the server-render path islands resolve their promises on.
async function prerenderToString(element: ReactElement): Promise<string> {
    const { prelude } = await prerender(element);
    const reader = prelude.getReader();
    const decoder = new TextDecoder();
    let html = '';
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        html += decoder.decode(value, { stream: true });
    }
    return html;
}

describe('island SSR (prerender)', () => {
    test('resolves a promise-backed view server-side', async () => {
        const Island = createIsland({
            useEnv: () => ({}),
            view: () =>
                createView
                    .chain({ id: viewParam<string>() })
                    .chain({ greeting: async ({ id }) => `hello ${id}` }),
            component: ({ greeting }) => <div>{greeting}</div>,
            loading: () => <div>loading</div>,
        });

        const html = await prerenderToString(<Island id="ssr" />);

        // The promise resolved during the server render (Suspense awaited it), so the
        // HTML carries the resolved content, not the loading fallback.
        expect(html).toContain('hello ssr');
        expect(html).not.toContain('loading');
    });

    test('renders the loading slot for a source-backed view (sources stay pending under SSR)', async () => {
        const pending: Source<{ id: string }> = {
            [SourceSymbol]: true,
            state: { status: 'pending' },
            attach: () => () => {},
        };
        const Island = createIsland({
            useEnv: () => ({}),
            view: () =>
                createView.chain({ id: viewParam<string>() }).chain({ data: () => pending }),
            component: () => <div>ready</div>,
            loading: () => <div>loading slot</div>,
        });

        const html = await prerenderToString(<Island id="ssr" />);

        // A source is a reactive state machine, not a promise — the server leaves it
        // pending and renders the loading slot; the client resolves it after hydration.
        expect(html).toContain('loading slot');
        expect(html).not.toContain('ready');
    });
});
