import { describe, test, expect } from 'vite-plus/test';
import { createHeadStore } from '../../head/store';
import { HeadProvider } from '../../head/HeadProvider';
import { Title } from '../../head/Title';
import { HydrationProvider } from '../../mandala/hydration';
import { route, type GenericRouteType } from '../../router/route';
import { Router } from '../../router/Router';
import { RouterStore } from '../../router/store';
import { RootStore, RootStoreProvider } from '../../stores/RootStore';
import { scope, input } from '../../scope/scope';
import { NotAvailableError } from '../../scope/source';
import { renderApp, type RenderAppSetup } from '../../ssr/renderApp';

const postScope = scope({ slug: input<string>() }).load({
    post: async ({ slug }) => {
        if (slug === 'missing') throw new NotAvailableError(`no post ${slug}`);
        if (slug === 'broken') throw new Error('backend exploded');
        return { slug, title: `Post ${slug}` };
    },
});

function PostPage({ post }: { post: { slug: string; title: string } }) {
    return (
        <>
            <Title>{post.title}</Title>
            <article>{post.title}</article>
        </>
    );
}

const routes = [
    route('/', 'home', () => <div>home</div>),
    route('/posts/:slug', 'post', PostPage, {
        scope: postScope,
        loading: () => <div>loading post</div>,
    }),
    route('/blog/:slug', 'blog', () => null, {
        redirect: { to: ({ slug }) => ({ name: 'post', slug }), permanent: true },
    }),
    route('*', 'notFound', () => <div>not found</div>),
] as const satisfies GenericRouteType[];

function createApp({ history, hydration }: RenderAppSetup) {
    const router = new RouterStore({}, routes, { history });
    const root = new RootStore({ router }, { isReady: true });
    const head = createHeadStore({ titleTemplate: (title) => `${title} · Blog` });

    function App() {
        return (
            <RootStoreProvider rootStore={root}>
                <HeadProvider store={head}>
                    <HydrationProvider {...hydration}>
                        <Router />
                    </HydrationProvider>
                </HeadProvider>
            </RootStoreProvider>
        );
    }
    return { router, App, head };
}

describe('renderApp', () => {
    test('a resolving route renders with content, head tags, and the payload script', async () => {
        const result = await renderApp({ url: '/posts/hello', createApp });

        expect(result.kind).toBe('rendered');
        if (result.kind !== 'rendered') return;
        expect(result.status).toBe(200);
        expect(result.html).toContain('Post hello');
        expect(result.headTags).toBe('<title data-rati-head="server">Post hello · Blog</title>');
        expect(result.stateScript).toContain('application/json');
        expect(result.hydration.router?.activeRouteName).toBe('post');
        // The resolved load was dehydrated for the client.
        expect(Object.values(result.hydration.data)[0]).toEqual({
            post: { slug: 'hello', title: 'Post hello' },
        });
        expect(result.errors).toEqual([]);
    });

    test('a not-available load derives 404; a failed load derives 500', async () => {
        const missing = await renderApp({ url: '/posts/missing', createApp });
        expect(missing.kind).toBe('rendered');
        if (missing.kind === 'rendered') {
            expect(missing.status).toBe(404);
            expect(missing.html).toContain('loading post');
        }

        const broken = await renderApp({
            url: '/posts/broken',
            createApp,
            onError: () => {},
        });
        if (broken.kind === 'rendered') {
            expect(broken.status).toBe(500);
        }
    });

    test('onError receives the render-level view of a failed load', async () => {
        const seen: unknown[] = [];
        const result = await renderApp({
            url: '/posts/broken',
            createApp,
            onError: (error) => seen.push(error),
        });

        // Two views of one failure, both live: the collector's `errors` is the server's
        // status input, `onError` is React's raw callback (it fires for errors inside a
        // Suspense boundary too, where the render itself degrades to the loading slot).
        expect(result.kind).toBe('rendered');
        if (result.kind !== 'rendered') return;
        expect(result.errors).toHaveLength(1);
        expect(seen.map((error) => (error as Error).message)).toEqual(['backend exploded']);
    });

    test('the rendered result and its script agree on the payload version', async () => {
        const result = await renderApp({ url: '/posts/hello', createApp });
        expect(result.kind).toBe('rendered');
        if (result.kind !== 'rendered') return;

        // `hydration` is what an SSG caller embeds itself; `stateScript` is the same
        // state already serialized. A version drift between them is a client that
        // rejects the payload and silently resolves from scratch.
        expect(result.hydration.v).toBe(1);
        expect(result.stateScript).toContain('"v":1');
    });

    test('a redirect route becomes a redirect result before any rendering', async () => {
        const result = await renderApp({ url: '/blog/hello', createApp });
        expect(result).toEqual({
            kind: 'redirect',
            to: '/posts/hello',
            permanent: true,
            status: 301,
        });
    });

    test('the catch-all match derives 404 with rendered content', async () => {
        const result = await renderApp({ url: '/no/such/page', createApp });
        expect(result.kind).toBe('rendered');
        if (result.kind !== 'rendered') return;
        expect(result.status).toBe(404);
        expect(result.matchedCatchAll).toBe(true);
        expect(result.html).toContain('not found');
    });

    test('no match at all (no catch-all in the table) → no-match', async () => {
        const bare = [route('/', 'home', () => <div>home</div>)] as const;
        const result = await renderApp({
            url: '/absent',
            createApp: ({ history, hydration }) => {
                const router = new RouterStore({}, bare, { history });
                const root = new RootStore({ router }, { isReady: true });
                return {
                    router,
                    App: () => (
                        <RootStoreProvider rootStore={root}>
                            <HydrationProvider {...hydration}>
                                <Router />
                            </HydrationProvider>
                        </RootStoreProvider>
                    ),
                };
            },
        });
        expect(result).toEqual({ kind: 'no-match', status: 404 });
    });

    test('a redirect whose target is outside the table still answers the 30x', async () => {
        // The router follows the hop, `/new` matches nothing, so `activeRoute` is null
        // and prepareRoute returns null — no route to describe. The declared 301 is
        // still the answer: renderApp reads the hop off the router before it can call
        // the request a no-match. Reachable whenever a target is same-origin but not a
        // rati route (a static file, a legacy app).
        const redirectOnly = [
            route('/old', 'old', () => null, { redirect: { to: '/new', permanent: true } }),
        ] as const satisfies GenericRouteType[];

        const result = await renderApp({
            url: '/old',
            createApp: ({ history, hydration }) => {
                const router = new RouterStore({}, redirectOnly, { history });
                const root = new RootStore({ router }, { isReady: true });
                return {
                    router,
                    App: () => (
                        <RootStoreProvider rootStore={root}>
                            <HydrationProvider {...hydration}>
                                <Router />
                            </HydrationProvider>
                        </RootStoreProvider>
                    ),
                };
            },
        });
        expect(result).toEqual({ kind: 'redirect', to: '/new', permanent: true, status: 301 });
    });

    test('an outside-the-table trail is 302 unless every hop was permanent', async () => {
        const chain = [
            route('/a', 'a', () => null, { redirect: { to: '/b', permanent: true } }),
            route('/b', 'b', () => null, { redirect: { to: '/outside' } }),
        ] as const satisfies GenericRouteType[];

        const result = await renderApp({
            url: '/a',
            createApp: ({ history, hydration }) => {
                const router = new RouterStore({}, chain, { history });
                const root = new RootStore({ router }, { isReady: true });
                return {
                    router,
                    App: () => (
                        <RootStoreProvider rootStore={root}>
                            <HydrationProvider {...hydration}>
                                <Router />
                            </HydrationProvider>
                        </RootStoreProvider>
                    ),
                };
            },
        });
        // The last hop's target, under the same every-hop-permanent rule the matched
        // case uses: one temporary hop makes the whole trail temporary.
        expect(result).toEqual({ kind: 'redirect', to: '/outside', permanent: false, status: 302 });
    });
});
