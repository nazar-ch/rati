import { describe, test, expect, afterEach } from 'vite-plus/test';
import type { FC } from 'react';
import { route } from '../../router/route';
import { scope, input, type ScopeComponent } from '../../scope/scope';
import { createTestRouter, deferred, flush, cleanup } from '../../testing';

afterEach(cleanup);

/*
    `keepStale` on a route — the case the option exists for, and the one that needs the
    Router's help.

    The Router keys a route's element by a per-navigation counter, so every navigation
    remounts the component. For a `keepStale` island that is fatal: what it keeps lives on
    the island instance, and a remounted island has no previous run to keep. So the mandala
    carries the flag and the Router keys those by route name instead — which still remounts
    across routes, and lets a same-route param change reach the mandala's own param-change
    path. These pins hold both halves of that.
*/

const Home: FC = () => <div>home</div>;

function productRoutes(
    gates: Map<string, ReturnType<typeof deferred<string>>>,
    keepStale: boolean,
) {
    const productScope = scope({ productId: input<string>() }).load({
        label: ({ productId }) => {
            const gate = deferred<string>();
            gates.set(productId, gate);
            return gate.promise;
        },
    });
    const Product: ScopeComponent<typeof productScope> = ({ productId, label }) => (
        <div>
            product {productId}: {label}
        </div>
    );
    return [
        route('/products/:productId', 'product', Product, {
            scope: productScope,
            loading: () => <div>loading slot</div>,
            ...(keepStale ? { keepStale: true } : {}),
        }),
        route('*', 'home', Home),
    ] as const;
}

describe('route keepStale', () => {
    test('a param change keeps the previous page rendered while the new one resolves', async () => {
        const gates = new Map<string, ReturnType<typeof deferred<string>>>();
        const router = await createTestRouter(productRoutes(gates, true), { url: '/products/1' });

        gates.get('1')!.resolve('AeroPress');
        await flush();
        expect(router.text()).toBe('product 1: AeroPress');

        await router.navigate('/products/3');

        // The URL has moved; the content has not. That gap is the feature.
        expect(router.router.path).toBe('/products/3');
        expect(router.text()).toBe('product 1: AeroPress');

        gates.get('3')!.resolve('Stagg');
        await flush();
        expect(router.text()).toBe('product 3: Stagg');
    });

    test('without the option the same navigation blanks to the loading slot', async () => {
        const gates = new Map<string, ReturnType<typeof deferred<string>>>();
        const router = await createTestRouter(productRoutes(gates, false), { url: '/products/1' });

        gates.get('1')!.resolve('AeroPress');
        await flush();

        await router.navigate('/products/3');

        expect(router.text()).toBe('loading slot');
    });

    test('leaving for a different route still remounts — the keying is per route, not global', async () => {
        const gates = new Map<string, ReturnType<typeof deferred<string>>>();
        const router = await createTestRouter(productRoutes(gates, true), { url: '/products/1' });

        gates.get('1')!.resolve('AeroPress');
        await flush();

        await router.navigate('/somewhere-else');
        expect(router.text()).toBe('home');

        // And coming back is a first load again — nothing kept across the gap.
        await router.navigate('/products/5');
        expect(router.text()).toBe('loading slot');
    });

    test('back() through the entry stack keeps content the same way forward navigation does', async () => {
        const gates = new Map<string, ReturnType<typeof deferred<string>>>();
        const router = await createTestRouter(productRoutes(gates, true), { url: '/products/1' });

        gates.get('1')!.resolve('AeroPress');
        await flush();
        await router.navigate('/products/3');
        gates.get('3')!.resolve('Stagg');
        await flush();
        expect(router.text()).toBe('product 3: Stagg');

        await router.back();

        // A POP is a param change like any other: product 3 stays up while 1 re-resolves.
        expect(router.router.path).toBe('/products/1');
        expect(router.text()).toBe('product 3: Stagg');

        gates.get('1')!.resolve('AeroPress again');
        await flush();
        expect(router.text()).toBe('product 1: AeroPress again');
    });
});
