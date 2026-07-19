import { describe, test, expect, afterEach } from 'vite-plus/test';
import { scope, input } from '../../scope/scope';
import { island } from '../../island/island';
import { prerenderToString, ssrRender, controllableSource, cleanup } from '../../testing';

afterEach(cleanup);

/*
    The SSR round-trip kit's own suite, and the docs' worked example verbatim: an async-load
    island that round-trips with zero client re-runs, plus the negative pin (a mismatch makes
    the harness fail loudly, and `allowMismatch` suppresses it).
*/

describe('prerenderToString', () => {
    test('resolves a promise-backed scope server-side (the content, not the loading slot)', async () => {
        const Island = island({
            scope: scope({ id: input<string>() }).load({
                greeting: async ({ id }) => `hello ${id}`,
            }),
            component: ({ greeting }) => <div>{greeting}</div>,
            loading: () => <div>loading slot</div>,
        });

        const html = await prerenderToString(<Island id="ssr" />);
        expect(html).toContain('hello ssr');
        expect(html).not.toContain('loading slot');
    });

    test('a marked source with no hydration collector stays pending (loading slot)', async () => {
        // The gating behavior: the SSR marker only engages under a HydrationProvider. A bare
        // prerender has no way to carry the value, so the source stays pending and the HTML
        // ships the loading slot — driven here through the promoted controllableSource.
        const Island = island({
            scope: scope().load({ live: () => controllableSource({ ssr: true, loads: 42 }) }),
            component: ({ live }) => <div>value {live}</div>,
            loading: () => <div>loading slot</div>,
        });

        const html = await prerenderToString(<Island />);
        expect(html).toContain('loading slot');
        expect(html).not.toContain('value 42');
    });
});

describe('ssrRender — the server half', () => {
    test('collects each resolved promise value, keyed by mandala then chain key', async () => {
        const Island = island({
            scope: scope({ id: input<string>() }).load({
                greeting: async ({ id }) => `hello ${id}`,
            }),
            component: ({ greeting }) => <div>{greeting}</div>,
            loading: () => <div>loading</div>,
        });

        const server = await ssrRender(<Island id="ssr" />);
        expect(server.html).toContain('hello ssr');
        // One island → one slice under its key. (The id is React's useId, so assert the slice.)
        expect(Object.values(server.data)).toEqual([{ greeting: 'hello ssr' }]);
        expect(Object.keys(server.seeds)).toHaveLength(0);
        expect(server.errors).toHaveLength(0);
    });
});

describe('ssrRender().hydrate() — the round-trip', () => {
    // The docs' worked example, verbatim: the page hydrates from the server's data without
    // re-running the load, and the mismatch guard is the loud "it refetched" signal.
    test('hydrates from the server payload without re-running the async load', async () => {
        let fetches = 0;
        const Page = island({
            scope: scope().load({
                user: async () => {
                    fetches++;
                    return { name: 'Ada' };
                },
            }),
            component: ({ user }) => <h1>{user.name}</h1>,
            loading: () => <p>loading</p>,
        });

        const server = await ssrRender(<Page />);
        expect(server.html).toContain('Ada'); // resolved server-side, in the HTML
        expect(fetches).toBe(1);

        const client = await server.hydrate();
        expect(client.text()).toContain('Ada'); // hydrated from the payload
        expect(fetches).toBe(1); // the load did NOT re-run
        // A clean round-trip: React had no mismatch to recover from (a re-run would have
        // re-suspended the loading slot over the server's <h1>, and the guard would have thrown).
        expect(client.recovered).toEqual([]);
    });

    test('a controllableSource loader (ssr: true) dehydrates as a value and never re-runs', async () => {
        let created = 0;
        const Island = island({
            scope: scope().load({
                // A fresh loader per render; the client's would run if the value weren't carried.
                clock: () => {
                    created++;
                    return controllableSource({ ssr: true, loads: `tick ${created}` });
                },
            }),
            component: ({ clock }) => <div>{clock}</div>,
            loading: () => <div>loading</div>,
        });

        const server = await ssrRender(<Island />);
        expect(server.html).toContain('tick 1');
        expect(Object.values(server.data)).toEqual([{ clock: 'tick 1' }]);
        expect(created).toBe(1);

        const client = await server.hydrate();
        // Short-circuited to the dehydrated value by key: the client never re-ran the load
        // factory, so the create-counter stayed at the server's 1 — the zero-re-run claim,
        // asserted on the producer's own counter.
        expect(client.text()).toContain('tick 1');
        expect(created).toBe(1);
        expect(client.recovered).toEqual([]);
    });
});

describe('ssrRender().hydrate() — the mismatch guard', () => {
    test('a mismatched client tree throws, naming the mismatch', async () => {
        const server = await ssrRender(<div>server content</div>);
        // The client renders something structurally different — a hydration mismatch React
        // recovers from by client-rendering. The guard turns that recovery into a failure.
        await expect(server.hydrate(<section>client content</section>)).rejects.toThrow(
            /recoverable error.*during hydration/i,
        );
    });

    test('allowMismatch suppresses the throw and exposes the recovered errors', async () => {
        const server = await ssrRender(<div>server content</div>);
        const client = await server.hydrate(<section>client content</section>, {
            allowMismatch: true,
        });
        // The degradation is now the assertion's subject: React recovered, and the client
        // tree is what ended up mounted.
        expect(client.recovered.length).toBeGreaterThan(0);
        expect(client.text()).toContain('client content');
    });
});
