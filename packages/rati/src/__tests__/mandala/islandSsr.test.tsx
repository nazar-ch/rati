import { describe, test, expect, afterEach, vi } from 'vite-plus/test';
import { prerender } from 'react-dom/static';
import { hydrateRoot } from 'react-dom/client';
import { act, cleanup } from '@testing-library/react';
import type { ReactElement } from 'react';
import { scope, input } from '../../scope/scope';
import { SourceSymbol, type Source, type SourceState } from '../../scope/source';
import { island } from '../../island/island';
import { createHydrationCollector, HydrationProvider } from '../../mandala/hydration';

afterEach(cleanup);

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
    test('resolves a promise-backed scope server-side', async () => {
        const Island = island({
            scope: scope({ id: input<string>() }).load({
                greeting: async ({ id }) => `hello ${id}`,
            }),
            component: ({ greeting }) => <div>{greeting}</div>,
            loading: () => <div>loading</div>,
        });

        const html = await prerenderToString(<Island id="ssr" />);

        // The promise resolved during the server render (Suspense awaited it), so the
        // HTML carries the resolved content, not the loading fallback.
        expect(html).toContain('hello ssr');
        expect(html).not.toContain('loading');
    });

    test('renders the loading slot for a source-backed scope (sources stay pending under SSR)', async () => {
        const pendingState: SourceState<{ id: string }> = { status: 'pending' };
        const pending: Source<{ id: string }> = {
            [SourceSymbol]: true,
            subscribe: () => () => {},
            getSnapshot: () => pendingState,
            attach: () => () => {},
        };
        const Island = island({
            scope: scope({ id: input<string>() }).load({ data: () => pending }),
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

describe('island SSR dehydration', () => {
    test('collects each resolved promise value, keyed by island id then chain key', async () => {
        const Island = island({
            scope: scope({ id: input<string>() }).load({
                greeting: async ({ id }) => `hello ${id}`,
            }),
            component: ({ greeting }) => <div>{greeting}</div>,
            loading: () => <div>loading</div>,
        });

        const collector = createHydrationCollector();
        await prerenderToString(
            <HydrationProvider collect={collector.collect}>
                <Island id="ssr" />
            </HydrationProvider>,
        );

        // One island → one slice, holding the resolved promise value under its key.
        // (The id is React's useId, so we assert on the slice rather than the literal.)
        const slices = Object.values(collector.data);
        expect(slices).toHaveLength(1);
        expect(slices[0]).toEqual({ greeting: 'hello ssr' });
    });

    test('rehydrates from the server data without re-running the promise', async () => {
        let calls = 0;
        const Island = island({
            scope: scope({ id: input<string>() }).load({
                greeting: async ({ id }: { id: string }) => {
                    calls++;
                    return `hello ${id}`;
                },
            }),
            component: ({ greeting }: { greeting: string }) => <div>{greeting}</div>,
            loading: () => <div>loading</div>,
        });

        // Server: render + collect. The promise runs exactly once.
        const collector = createHydrationCollector();
        const html = await prerenderToString(
            <HydrationProvider collect={collector.collect}>
                <Island id="ssr" />
            </HydrationProvider>,
        );
        expect(html).toContain('hello ssr');
        expect(calls).toBe(1);

        // Client: hydrate the server HTML, feeding the collected data back. The
        // island's useId matches the server's (same tree position), so its slice is
        // found and the promise is short-circuited — not run again, no loading flash.
        const container = document.createElement('div');
        container.innerHTML = html;
        document.body.appendChild(container);
        // "No loading flash" is a claim about mismatches, so it is asserted on the
        // channel that carries them: a client that re-ran the promise would render the
        // loading slot over the server's ready HTML, and React would report the recovery
        // here — never to console.error, whose default handler is `reportGlobalError`.
        const recovered = vi.fn();
        await act(async () => {
            hydrateRoot(
                container,
                <HydrationProvider data={collector.data}>
                    <Island id="ssr" />
                </HydrationProvider>,
                { onRecoverableError: recovered },
            );
        });

        expect(calls).toBe(1);
        expect(container.textContent).toContain('hello ssr');
        expect(recovered).not.toHaveBeenCalled();
    });

    test('nested islands each collect their own slice (composition, no key collision)', async () => {
        const Child = island({
            scope: scope().load({ value: async () => 'child-data' }),
            component: ({ value }) => <span>{value}</span>,
            loading: () => <span>l</span>,
        });
        const Parent = island({
            scope: scope().load({ value: async () => 'parent-data' }),
            component: ({ value }) => (
                <div>
                    {value}
                    <Child />
                </div>
            ),
            loading: () => <div>l</div>,
        });

        const collector = createHydrationCollector();
        const html = await prerenderToString(
            <HydrationProvider collect={collector.collect}>
                <Parent />
            </HydrationProvider>,
        );

        expect(html).toContain('parent-data');
        expect(html).toContain('child-data');

        // Two distinct island ids, each with its own slice — even though both chains
        // use the key `value`, the useId scope keeps them apart.
        const slices = Object.values(collector.data);
        expect(slices).toHaveLength(2);
        expect(slices).toContainEqual({ value: 'parent-data' });
        expect(slices).toContainEqual({ value: 'child-data' });
    });
});
