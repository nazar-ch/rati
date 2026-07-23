import { describe, test, expect, afterEach } from 'vite-plus/test';
import { scope, input } from '../../scope/scope';
import { island } from '../../island/island';
import { controllableSource, renderIsland, ssrRender, cleanup } from '../../testing';

afterEach(cleanup);

/*
    Per-island `ssr: false` — the opt-out that keeps one island from gating TTFB, and the
    other half of the SSR matrix from the source-side `ssr: true` marker.

    What the pins are really guarding is the *hydration* contract. The server ships the
    loading slot; the client's first render must ship the same slot, and only then resolve.
    `ssrRender().hydrate()` throws on any recoverable error by default — so every clean
    `.hydrate()` below is itself the no-mismatch assertion, not decoration around one.
*/

// The island under test: one async load, counted, so "did this run server-side / twice?"
// is a number rather than an inference off the HTML.
function optedOutIsland(runs: { count: number }) {
    return island({
        scope: scope({ id: input<string>() }).load({
            note: async ({ id }) => {
                runs.count++;
                return `resolved ${id}`;
            },
        }),
        component: ({ note }) => <div>{note}</div>,
        loading: () => <div>loading slot</div>,
        ssr: false,
    });
}

describe('island ssr: false — the server render', () => {
    test('ships the loading slot, starts no load, and records no hydration entry', async () => {
        const runs = { count: 0 };
        const Island = optedOutIsland(runs);

        const server = await ssrRender(<Island id="a" />);

        expect(server.html).toContain('loading slot');
        expect(server.html).not.toContain('resolved a');
        // The point of the option: the load never ran, so it never gated the document.
        expect(runs.count).toBe(0);
        expect(server.data).toEqual({});
        expect(server.seeds).toEqual({});
        // An opted-out island can't contribute SSR errors — by construction, nothing ran.
        expect(server.errors).toEqual([]);
    });

    test('a sibling island without the option still resolves and dehydrates', async () => {
        const runs = { count: 0 };
        const OptedOut = optedOutIsland(runs);
        const Normal = island({
            scope: scope().load({ headline: async () => 'server-resolved headline' }),
            component: ({ headline }) => <h1>{headline}</h1>,
            loading: () => <div>headline loading</div>,
        });

        const server = await ssrRender(
            <div>
                <Normal />
                <OptedOut id="b" />
            </div>,
        );

        expect(server.html).toContain('server-resolved headline');
        expect(server.html).toContain('loading slot');
        expect(runs.count).toBe(0);
        // Exactly one mandala slice on the wire — the normal one's.
        expect(Object.values(server.data)).toEqual([{ headline: 'server-resolved headline' }]);
    });

    test('the island opt-out wins over an `ssr: true` source inside its scope', async () => {
        const log: string[] = [];
        const Island = island({
            scope: scope().load({
                marked: () =>
                    controllableSource<string>({
                        ssr: true,
                        loads: 'marked value',
                        onAttach: () => log.push('attach'),
                    }),
            }),
            component: ({ marked }) => <div>{marked}</div>,
            loading: () => <div>loading slot</div>,
            ssr: false,
        });

        const server = await ssrRender(<Island />);

        expect(server.html).toContain('loading slot');
        // The marker authorizes an attach *during render*; the island never rendered the
        // level, so there was nothing to authorize.
        expect(log).toEqual([]);
        expect(server.data).toEqual({});
        expect(server.seeds).toEqual({});
    });
});

describe('island ssr: false — the round trip', () => {
    test('hydrates the slot without a mismatch, then resolves on the client', async () => {
        const runs = { count: 0 };
        const Island = optedOutIsland(runs);

        const server = await ssrRender(<Island id="c" />);
        // Throws if React reports a recoverable error — the "client re-suspended over the
        // server HTML" bug this option would otherwise walk straight into.
        const client = await server.hydrate();

        expect(client.text()).toContain('resolved c');
        // Once, on the client. The server's zero plus this one is the whole story.
        expect(runs.count).toBe(1);
    });

    test('the sibling hydrates from the payload while the opted-out island fetches', async () => {
        const runs = { count: 0 };
        let normalRuns = 0;
        const OptedOut = optedOutIsland(runs);
        const Normal = island({
            scope: scope().load({
                headline: async () => {
                    normalRuns++;
                    return 'server-resolved headline';
                },
            }),
            component: ({ headline }) => <h1>{headline}</h1>,
            loading: () => <div>headline loading</div>,
        });
        const page = (
            <div>
                <Normal />
                <OptedOut id="d" />
            </div>
        );

        const server = await ssrRender(page);
        const client = await server.hydrate();

        expect(client.text()).toContain('server-resolved headline');
        expect(client.text()).toContain('resolved d');
        // The dehydrated one did not re-run; the opted-out one ran for the first time.
        expect(normalRuns).toBe(1);
        expect(runs.count).toBe(1);
    });
});

describe('island ssr: false — client-only', () => {
    test('reads as a no-op: the load starts on the first render, as without the option', async () => {
        const runs = { count: 0 };
        const started: number[] = [];
        const config = {
            scope: scope({ id: input<string>() }).load({
                note: async ({ id }) => {
                    runs.count++;
                    started.push(runs.count);
                    return `resolved ${id}`;
                },
            }),
            component: ({ note }: { note: string }) => <div>{note}</div>,
            loading: () => <div>loading slot</div>,
            ssr: false,
        };

        const handle = await renderIsland(config, { props: { id: 'e' } });

        expect(handle.slot()).toBe('content');
        expect(handle.text()).toBe('resolved e');
        // No deferred frame: with no server in the picture, `AfterHydration` reads the
        // client snapshot on its very first render.
        expect(runs.count).toBe(1);
    });
});
