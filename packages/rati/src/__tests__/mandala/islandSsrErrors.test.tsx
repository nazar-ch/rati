import { describe, test, expect } from 'vite-plus/test';
import { scope, input } from '../../scope/scope';
import { NotAvailableError } from '../../scope/source';
import { island } from '../../island/island';
import { deferred, ssrRender } from '../../testing';

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

    // The recording guard's two halves — it must fire once *within* a render and once
    // *per* render. Both directions are load-bearing: the first keeps a resumed level from
    // stacking handlers, the second is what a module-global guard silently broke (DX-08).
    test('one render records a rejection once, however often the suspended level resumes', async () => {
        const gate = deferred<string>();
        const Island = island({
            scope: scope().load({ post: () => gate.promise }),
            component: ({ post }) => <div>{post}</div>,
            loading: () => <div>loading</div>,
        });

        // Rejected *after* the level suspended, so the Step renders a second time on
        // resume and passes the same cached promise cell through the recorder again.
        setTimeout(() => gate.reject(new Error('backend exploded')), 0);
        const server = await ssrRender(<Island />, { onError: () => {} });

        expect(server.errors).toHaveLength(1);
        expect(server.errors[0]!.error.message).toBe('backend exploded');
    });

    test('a promise reused across two renders is recorded by both collectors', async () => {
        // One promise instance, two server renders — the shape of a module-level load, or
        // of a promise a test builds once and renders twice. The rejection ledger is the
        // run's, so the second render's collector sees the rejection too; when it was the
        // module's, `errors` came back empty and the 404 signal went quiet.
        const failing = Promise.reject(new NotAvailableError('gone'));
        // The resolver attaches its handler mid-render, later than node's
        // unhandled-rejection watch — this keeps the runner quiet, nothing else.
        failing.catch(() => {});

        const Island = island({
            scope: scope().load({ post: failing }),
            component: ({ post }) => <div>{String(post)}</div>,
            loading: () => <div>loading</div>,
        });

        const first = await ssrRender(<Island />, { onError: () => {} });
        const second = await ssrRender(<Island />, { onError: () => {} });

        expect(first.errors.map((entry) => entry.error.code)).toEqual(['not-available']);
        expect(second.errors.map((entry) => entry.error.code)).toEqual(['not-available']);
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
