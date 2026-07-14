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
        expect(result.headTags).toBe('<title>Post hello · Blog</title>');
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
});
