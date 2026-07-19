import { describe, test, expect } from 'vite-plus/test';
import { scope, input } from '../../scope/scope';
import { NotAvailableError } from '../../scope/source';
import { island } from '../../island/island';
import { ssrRender } from '../../testing';

/*
    What a rejecting promise load does under a collected server render — pinned by
    experiment: `prerender` RESOLVES (it does not reject), React emits the loading slot
    wrapped in its "switched to client rendering" marker, and the client re-runs the
    load on hydration. The error boundary/slot never participates server-side. The
    collector's `errors` is the piece rati adds: the server's input for the response
    status (not-available → 404) before that degraded 200 goes out.
*/

describe('island SSR error collection', () => {
    test('a rejecting load records a normalized failed error; the render degrades to the loading slot', async () => {
        const Island = island({
            scope: scope({ id: input<string>() }).load({
                greeting: async () => {
                    throw new Error('backend exploded');
                },
            }),
            component: ({ greeting }) => <div>content: {String(greeting)}</div>,
            loading: () => <div>LOADING-SLOT</div>,
            error: ({ error }) => <div>ERROR-SLOT: {error.code}</div>,
        });

        const server = await ssrRender(<Island id="x" />, { onError: () => {} });

        // prerender resolved and emitted the loading slot — never the error slot.
        expect(server.html).toContain('LOADING-SLOT');
        expect(server.html).not.toContain('ERROR-SLOT');

        expect(server.errors).toHaveLength(1);
        expect(server.errors[0]!.key).toBe('greeting');
        expect(server.errors[0]!.error.code).toBe('failed');
        expect(server.errors[0]!.error.message).toBe('backend exploded');
        expect(server.data).toEqual({});
    });

    test('NotAvailableError keeps its code across the collector — the 404 signal', async () => {
        const Island = island({
            scope: scope({ slug: input<string>() }).load({
                post: async ({ slug }) => {
                    throw new NotAvailableError(`no post ${slug}`);
                },
            }),
            component: () => <div>post</div>,
            loading: () => <div>loading</div>,
        });

        const server = await ssrRender(<Island slug="missing" />, { onError: () => {} });

        expect(server.errors).toHaveLength(1);
        expect(server.errors[0]!.error.code).toBe('not-available');
    });

    test('a failing dependent level still records; earlier levels dehydrate normally', async () => {
        const Island = island({
            scope: scope()
                .load({ user: async () => ({ name: 'Ada' }) })
                .load({
                    posts: async () => {
                        throw new NotAvailableError('no posts');
                    },
                }),
            component: () => <div>page</div>,
            loading: () => <div>loading</div>,
        });

        const server = await ssrRender(<Island />, { onError: () => {} });

        expect(server.errors.map((entry) => entry.key)).toEqual(['posts']);
        const dehydrated = Object.values(server.data)[0];
        expect(dehydrated).toEqual({ user: { name: 'Ada' } });
    });

    test('a clean render records no errors', async () => {
        const Island = island({
            scope: scope().load({ greeting: async () => 'hello' }),
            component: ({ greeting }) => <div>{greeting}</div>,
            loading: () => <div>loading</div>,
        });

        const server = await ssrRender(<Island />, { onError: () => {} });

        expect(server.html).toContain('hello');
        expect(server.errors).toEqual([]);
    });
});
