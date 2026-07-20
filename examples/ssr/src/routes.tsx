import { input, lazy, route, scope } from 'rati';
import type { GenericRouteType } from 'rati';
import { fetchProfile } from './data';
import { productScope } from './scopes';
import { About } from './components/About';
import { Broken } from './components/Broken';
import { Counter } from './components/Counter';
import { DeferredPage } from './components/Deferred';
import { Fallback, FallbackWrapper } from './components/Fallback';
import { Flaky } from './components/Flaky';
import { Home } from './components/Home';
import { Live } from './components/Live';
import { NotFound } from './components/NotFound';
import { ProductError, ProductPage } from './components/Product';
import { ProfilePage } from './components/Profile';

declare module 'rati' {
    interface RatiUserTypes {
        routes: typeof routes;
    }
}

const aboutScope = scope().load({
    // Both loads are async (promises), so the island engine dehydrates their
    // resolved values into the SSR payload — the client reuses them verbatim
    // instead of re-running the loads (a sync load would not be serialized, and
    // its client re-run would mismatch the server HTML).
    serverTime: async () => new Date().toISOString(),
    fact: async () => {
        // Pretend this is a database/HTTP fetch. Awaited on the server before
        // render; embedded in the SSR payload so the client doesn't refetch.
        await new Promise((resolve) => setTimeout(resolve, 10));
        const facts = [
            'Octopuses have three hearts.',
            'Honey never spoils.',
            'Bananas are berries; strawberries are not.',
        ];
        return facts[Math.floor(Math.random() * facts.length)]!;
    },
});

const profileScope = scope({ userId: input<string>() }).load({
    profile: ({ userId }) => fetchProfile(userId),
});

const splitScope = scope().load({ chapter: async () => 'resolved before the chunk arrived' });

// A route in a chunk of its own. `lazy()` is unchanged by any of this — but built
// through rati/vite, the plugin records which module it imports, so the server can
// name this page's chunk in the HTML (`<link rel="modulepreload">`) instead of leaving
// the browser to discover it after hydration.
const Split = lazy(() => import('./components/Split'));

export const routes = [
    route('/', 'home', Home),
    route('/about', 'about', About, { scope: aboutScope }),
    // `keepStale`: switching products keeps the current page rendered (dimmed, via the
    // island's own `isStale`) until the new waterfall resolves, instead of blanking.
    route('/products/:productId', 'product', ProductPage, {
        scope: productScope,
        error: ProductError,
        keepStale: true,
    }),
    route('/profile/:userId', 'profile', ProfilePage, { scope: profileScope }),
    route('/counter', 'counter', Counter),
    // Two islands, one page: the second sets `ssr: false`, so its loading slot is what
    // the server ships and the browser does the load after hydration.
    route('/deferred', 'deferred', DeferredPage),
    route('/live', 'live', Live),
    route('/flaky', 'flaky', Flaky),
    // The island inside sets `ssrErrors: 'dehydrate'`, so the failure its load hits on the
    // server is rendered as the error slot *and* carried to the client — which hydrates
    // onto that slot instead of re-running the load. Answered with a 500 either way.
    route('/broken', 'broken', Broken),
    // Throws during the server render from its `wrapper` — which the Router renders
    // outside the route's island, so no boundary catches it and `renderApp` rejects
    // rather than encoding it in a status. rati/server answers that with the CSR shell
    // (assets, no payload), so the page still works in the browser.
    route('/fallback', 'fallback', Fallback, { wrapper: FallbackWrapper }),
    route('/split', 'split', Split, { scope: splitScope }),
    // A route-level redirect: the legacy /store/:id path maps its param onto the
    // product route. The client follows it with a history replace; the server
    // responds 301 before rendering anything (see prepareRoute / renderApp).
    route('/store/:productId', 'store', () => null, {
        redirect: { to: ({ productId }) => ({ name: 'product', productId }), permanent: true },
    }),
    route('*', 'notFound', NotFound),
] as const satisfies GenericRouteType[];
