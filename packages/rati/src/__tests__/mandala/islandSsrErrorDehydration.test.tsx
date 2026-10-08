import { describe, test, expect, afterEach, vi } from 'vite-plus/test';

import { act } from 'react';

import { island } from '../../island/island.js';
import { scope, input } from '../../scope/scope.js';
import { NotAvailableError, type SourceError } from '../../scope/source.js';
import { serializeHydration } from '../../ssr/payload.js';
import { cleanup, flush, prerenderToString, ssrRender } from '../../testing/index.js';

afterEach(cleanup);

/*
    `ssrErrors: 'dehydrate'`: the throw is taken at the resolver, the error slot renders into the
    HTML, and the client hydrates the cell straight to its error state — no re-run, no spinner.
    The default, `'retry'`, is islandSsrErrors.test.tsx's. Every `.hydrate()` below asserts no
    recoverable error.
*/

/** An island whose one load fails while `state.failing` is set, counting every call. */
function failingIsland(state: { calls: number; failing: boolean }, extra = {}) {
    return island({
        scope: scope({ id: input<string>() }).load({
            post: async ({ id }: { id: string }) => {
                state.calls++;
                if (state.failing) throw new Error(`no post ${id}`);
                return `post ${id}`;
            },
        }),
        component: ({ post }: { post: string }) => <div>content: {post}</div>,
        loading: () => <div>LOADING-SLOT</div>,
        // One interpolation, so the assertions can read the rendered line whole — React
        // splits a slot's text at every expression boundary in the server HTML.
        error: ({ error, retry }: { error: SourceError; retry: () => void }) => (
            <div>
                {`ERROR-SLOT: ${error.code} — ${error.message}`}
                <button type="button" onClick={retry}>
                    retry
                </button>
            </div>
        ),
        ssrErrors: 'dehydrate' as const,
        ...extra,
    });
}

describe('ssrErrors: dehydrate — the server render', () => {
    test('renders the error slot into the HTML and carries the failure on the wire', async () => {
        const state = { calls: 0, failing: true };
        const Island = failingIsland(state);

        // No `onError` swallow, unlike every test of the default mode: nothing throws
        // during this render, so React has nothing to report. That is the mode working —
        // the render resolves normally rather than degrading through a caught error.
        const server = await ssrRender(<Island id="x" />);

        expect(server.html).toContain('ERROR-SLOT: failed — no post x');
        expect(server.html).not.toContain('LOADING-SLOT');
        expect(state.calls).toBe(1);

        // The wire's third section, one entry, keyed like the other two.
        const slices = Object.values(server.dehydratedErrors);
        expect(slices).toEqual([{ post: { code: 'failed', message: 'no post x' } }]);
        expect(server.data).toEqual({});
    });

    test('the status signal is unchanged — the failure is recorded as it always was', async () => {
        const state = { calls: 0, failing: true };
        const Island = failingIsland(state);

        const server = await ssrRender(<Island id="x" />);

        // `errors` (the flat list renderApp derives a status from) sees every failure
        // whichever mode the island runs; only `dehydratedErrors` is opt-in.
        expect(server.errors).toHaveLength(1);
        expect(server.errors[0]!.key).toBe('post');
        expect(server.errors[0]!.error.code).toBe('failed');
    });

    test('a not-available keeps its code across both — a 404 with a rendered error slot', async () => {
        const Island = island({
            scope: scope({ slug: input<string>() }).load({
                post: async ({ slug }) => {
                    throw new NotAvailableError(`no post ${slug}`);
                },
            }),
            component: () => <div>post</div>,
            loading: () => <div>LOADING-SLOT</div>,
            error: ({ error }) => <div>{`ERROR-SLOT: ${error.code}`}</div>,
            ssrErrors: 'dehydrate',
        });

        const server = await ssrRender(<Island slug="missing" />);

        expect(server.html).toContain('ERROR-SLOT: not-available');
        expect(server.errors[0]!.error.code).toBe('not-available');
        expect(Object.values(server.dehydratedErrors)[0]).toEqual({
            post: { code: 'not-available', message: 'no post missing' },
        });
    });

    test('an earlier level still dehydrates its values; the failing one dehydrates its error', async () => {
        const Island = island({
            scope: scope()
                .load({ user: async () => ({ name: 'Ada' }) })
                .load({
                    posts: async () => {
                        throw new Error('backend exploded');
                    },
                }),
            component: () => <div>page</div>,
            loading: () => <div>LOADING-SLOT</div>,
            error: ({ error }) => <div>{`ERROR-SLOT: ${error.message}`}</div>,
            ssrErrors: 'dehydrate',
        });

        const server = await ssrRender(<Island />);

        expect(server.html).toContain('ERROR-SLOT: backend exploded');
        expect(Object.values(server.data)[0]).toEqual({ user: { name: 'Ada' } });
        expect(Object.values(server.dehydratedErrors)[0]).toEqual({
            posts: { code: 'failed', message: 'backend exploded' },
        });
    });

    test('`cause` is dropped on the way over — the one field with no wire shape', async () => {
        const backendError = new Error('backend exploded');
        const Island = island({
            scope: scope().load({
                post: async () => {
                    throw backendError;
                },
            }),
            component: () => <div>post</div>,
            loading: () => <div>LOADING-SLOT</div>,
            error: ({ error }) => <div>ERROR-SLOT: {error.code}</div>,
            ssrErrors: 'dehydrate',
        });

        const server = await ssrRender(<Island />);

        // The server keeps the live Error (its stack is the server's own diagnostic)...
        expect(server.errors[0]!.error.cause).toBe(backendError);
        // ...and the wire carries only what survives JSON. An Error stringifies to `{}`,
        // so shipping it would hand the client a lie shaped like a cause.
        const wire = Object.values(server.dehydratedErrors)[0]!['post']!;
        expect(wire).toEqual({ code: 'failed', message: 'backend exploded' });
        expect('cause' in wire).toBe(false);
    });

    test('a message that could close the script tag is escaped like every other value', async () => {
        const Island = island({
            scope: scope().load({
                post: async () => {
                    throw new Error('</script><script>alert(1)</script>');
                },
            }),
            component: () => <div>post</div>,
            loading: () => <div>LOADING-SLOT</div>,
            error: () => <div>ERROR-SLOT</div>,
            ssrErrors: 'dehydrate',
        });

        const server = await ssrRender(<Island />);
        const tag = serializeHydration({
            data: server.data,
            seeds: server.seeds,
            errors: server.dehydratedErrors,
        });

        // One `</script>` in the document, the tag's own — the payload's `<` `>` `&`
        // escaping covers the new section because it runs over the serialized JSON.
        expect(tag.match(/<\/script>/g)).toHaveLength(1);
        expect(tag).toContain('\\u003c/script\\u003e');
        expect(JSON.parse(tag.slice(tag.indexOf('>') + 1, tag.lastIndexOf('<')))).toMatchObject({
            errors: Object.fromEntries(
                Object.keys(server.dehydratedErrors).map((id) => [
                    id,
                    { post: { code: 'failed', message: '</script><script>alert(1)</script>' } },
                ]),
            ),
        });
    });

    test('without a collector the mode is inert — the wire is what makes it honest', async () => {
        // A bare `prerender` with no HydrationProvider: nothing carries the failure over, so
        // the client re-runs the load and paints something else — worse than the default. The
        // source-side `ssr` marker gates the same way.
        const state = { calls: 0, failing: true };
        const Island = failingIsland(state);

        const html = await prerenderToString(<Island id="x" />, { onError: () => {} });

        expect(html).toContain('LOADING-SLOT');
        expect(html).not.toContain('ERROR-SLOT');
    });

    test('without an error slot there is nothing deterministic to paint — the default degradation', async () => {
        const state = { calls: 0, failing: true };
        const Island = island({
            scope: scope().load({
                post: async () => {
                    state.calls++;
                    throw new Error('backend exploded');
                },
            }),
            component: ({ post }) => <div>{String(post)}</div>,
            loading: () => <div>LOADING-SLOT</div>,
            ssrErrors: 'dehydrate',
        });

        const server = await ssrRender(<Island />, { onError: () => {} });

        // No slot, so the throw stands and React degrades exactly as it does by default...
        expect(server.html).toContain('LOADING-SLOT');
        // ...but the failure still crossed the wire, so the client surfaces it through the
        // app's own boundary instead of silently re-running the load.
        expect(Object.values(server.dehydratedErrors)[0]).toEqual({
            post: { code: 'failed', message: 'backend exploded' },
        });
    });
});

describe('ssrErrors: dehydrate — the round trip', () => {
    test('the client hydrates to the error slot without re-running the load', async () => {
        const state = { calls: 0, failing: true };
        const Island = failingIsland(state);

        const server = await ssrRender(<Island id="x" />);
        const client = await server.hydrate();

        expect(client.text()).toContain('ERROR-SLOT: failed — no post x');
        // The whole point: one call, the server's. And a clean `.hydrate()` is the
        // no-mismatch assertion — it throws on any recoverable error.
        expect(state.calls).toBe(1);
        expect(client.recovered).toEqual([]);
    });

    test('the slot`s retry re-runs the load and recovers', async () => {
        const state = { calls: 0, failing: true };
        const Island = failingIsland(state);

        const server = await ssrRender(<Island id="x" />);
        const client = await server.hydrate();

        state.failing = false;
        await act(async () => {
            client.container.querySelector('button')!.click();
            await flush();
        });

        expect(client.text()).toContain('content: post x');
        // Two: the server's, and the one the human asked for. The dehydrated error is a
        // FIRST resolution's, so the retry's generation reads no payload slice.
        expect(state.calls).toBe(2);
    });

    test('the default mode is untouched — the client re-runs and heals itself', async () => {
        const state = { calls: 0, failing: true };
        // Same island, same failure, no option: the baseline this mode is an alternative
        // to. Its degradation is a deliberate one, hence allowMismatch.
        const Island = failingIsland(state, { ssrErrors: undefined });

        const server = await ssrRender(<Island id="x" />, { onError: () => {} });
        expect(server.html).toContain('LOADING-SLOT');
        expect(server.dehydratedErrors).toEqual({});

        state.failing = false;
        const client = await server.hydrate(undefined, { allowMismatch: true });
        await act(flush);

        expect(client.text()).toContain('content: post x');
        expect(state.calls).toBe(2);
    });

    test('a dehydrated error is claimed, so the unclaimed-payload watchdog stays quiet', async () => {
        vi.useFakeTimers();
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        try {
            const state = { calls: 0, failing: true };
            const Island = failingIsland(state);

            const server = await ssrRender(<Island id="x" />);
            await server.hydrate();
            await act(async () => {
                await vi.advanceTimersByTimeAsync(5000);
            });

            expect(warn).not.toHaveBeenCalled();
        } finally {
            warn.mockRestore();
            vi.useRealTimers();
        }
    });
});

describe('ssrErrors: dehydrate — composed with retry', () => {
    /*
        Does a client-side `retry` policy pick up a failure that came off the wire? It does: the
        policy asks only whether this is a `failed` it has budget for. So the deterministic first
        paint is the SERVER's, and a policy on top trades it for another attempt.
    */
    test('the policy retries a dehydrated failure, and the error slot never mounts', async () => {
        vi.useFakeTimers();
        try {
            const state = { calls: 0, failing: true };
            const Island = failingIsland(state, { retry: { count: 1, backoffMs: 500 } });

            const server = await ssrRender(<Island id="x" />);
            expect(server.html).toContain('ERROR-SLOT');

            state.failing = false;
            const client = await server.hydrate();
            // The error boundary rules during RENDER, so the slot the HTML shipped is
            // replaced on the first client pass — the island is resolving, not failing.
            expect(client.text()).toContain('LOADING-SLOT');

            await act(async () => {
                await vi.advanceTimersByTimeAsync(500);
            });
            expect(client.text()).toContain('content: post x');
            expect(state.calls).toBe(2);
        } finally {
            vi.useRealTimers();
        }
    });

    test('a spent budget lands back on the error slot', async () => {
        vi.useFakeTimers();
        try {
            const state = { calls: 0, failing: true };
            const Island = failingIsland(state, { retry: { count: 1, backoffMs: 500 } });

            const server = await ssrRender(<Island id="x" />);
            const client = await server.hydrate();

            await act(async () => {
                await vi.advanceTimersByTimeAsync(500);
            });

            expect(client.text()).toContain('ERROR-SLOT: failed — no post x');
            expect(state.calls).toBe(2);
        } finally {
            vi.useRealTimers();
        }
    });
});
