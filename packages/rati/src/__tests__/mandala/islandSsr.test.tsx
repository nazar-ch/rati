import { describe, test, expect, afterEach } from 'vite-plus/test';
import { scope, input } from '../../scope/scope';
import { island } from '../../island/island';
import { prerenderToString, ssrRender, controllableSource, cleanup } from '../../testing';

afterEach(cleanup);

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
        // A source is a reactive state machine, not a promise: its `attach` runs from an
        // effect, which `prerender` never runs — so the server leaves it pending and renders
        // the loading slot, and the client resolves it after hydration. A never-driven
        // controllableSource is exactly that pending source.
        const pending = controllableSource();
        const Island = island({
            scope: scope({ id: input<string>() }).load({ data: () => pending }),
            component: () => <div>ready</div>,
            loading: () => <div>loading slot</div>,
        });

        const html = await prerenderToString(<Island id="ssr" />);

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

        const server = await ssrRender(<Island id="ssr" />);

        // One island → one slice, holding the resolved promise value under its key.
        // (The id is React's useId, so we assert on the slice rather than the literal.)
        const slices = Object.values(server.data);
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
        const server = await ssrRender(<Island id="ssr" />);
        expect(server.html).toContain('hello ssr');
        expect(calls).toBe(1);

        // Client: hydrate the server HTML, feeding the collected data back. The island's
        // useId matches the server's (same tree position), so its slice is found and the
        // promise is short-circuited — not run again, no loading flash. "No loading flash"
        // is a claim about mismatches, and the round-trip's guard is exactly that channel: a
        // client that re-ran the promise would render the loading slot over the server's
        // ready HTML, React would report the recovery, and `.hydrate()` would have thrown.
        const client = await server.hydrate();

        expect(calls).toBe(1);
        expect(client.text()).toContain('hello ssr');
        expect(client.recovered).toEqual([]);
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

        const server = await ssrRender(<Parent />);

        expect(server.html).toContain('parent-data');
        expect(server.html).toContain('child-data');

        // Two distinct island ids, each with its own slice — even though both chains
        // use the key `value`, the useId scope keeps them apart.
        const slices = Object.values(server.data);
        expect(slices).toHaveLength(2);
        expect(slices).toContainEqual({ value: 'parent-data' });
        expect(slices).toContainEqual({ value: 'child-data' });
    });
});
