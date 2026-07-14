import { useContext } from 'react';
import { hook, input, route, scope } from 'rati';
import type { GenericRouteType } from 'rati';
import { RegionContext } from './appContext';
import { fetchProduct, fetchProfile, fetchReviews } from './data';
import { About } from './components/About';
import { Counter } from './components/Counter';
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

// A waterfall: the `productId` input, a `hook()` load that injects the region from
// React context (the DI seam — no `env` to thread), then a dependent `product`
// load, then `reviews` keyed off the resolved product. The promise levels dehydrate.
const productScope = scope({ productId: input<string>() })
    .load({ region: hook(() => useContext(RegionContext)) })
    .load({ product: ({ productId, region }) => fetchProduct(productId, region) })
    .load({ reviews: ({ product }) => fetchReviews(product.id) });

const profileScope = scope({ userId: input<string>() }).load({
    profile: ({ userId }) => fetchProfile(userId),
});

export const routes = [
    route('/', 'home', Home),
    route('/about', 'about', About, { scope: aboutScope }),
    route('/products/:productId', 'product', ProductPage, {
        scope: productScope,
        error: ProductError,
    }),
    route('/profile/:userId', 'profile', ProfilePage, { scope: profileScope }),
    route('/counter', 'counter', Counter),
    route('/live', 'live', Live),
    route('/flaky', 'flaky', Flaky),
    // A route-level redirect: the legacy /store/:id path maps its param onto the
    // product route. The client follows it with a history replace; the server
    // responds 301 before rendering anything (see prepareRoute / renderApp).
    route('/store/:productId', 'store', () => null, {
        redirect: { to: ({ productId }) => ({ name: 'product', productId }), permanent: true },
    }),
    route('*', 'notFound', NotFound),
] as const satisfies GenericRouteType[];
