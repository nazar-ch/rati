import { describe, test, expect, afterEach } from 'vite-plus/test';
import { act, type FC } from 'react';
import { route, type GenericRouteType } from '../../router/route';
import { Link } from '../../router/Link';
import { createUseStoresHook, type GlobalStores } from '../../stores/RootStore';
import { createTestRouter, renderWithStores, cleanup } from '../../testing';

afterEach(cleanup);

const HomePage: FC = () => <div>home page</div>;
const AboutPage: FC = () => <div>about page</div>;
const routes = [
    route('/', 'home', HomePage),
    route('/about', 'about', AboutPage),
] satisfies readonly GenericRouteType[];

describe('createTestRouter', () => {
    test('renders the matched route and navigates', async () => {
        const tr = await createTestRouter(routes, { url: '/' });
        expect(tr.text()).toBe('home page');
        expect(tr.router.path).toBe('/');

        await tr.navigate('/about');
        expect(tr.text()).toBe('about page');
        expect(tr.router.path).toBe('/about');
    });

    test('back() and forward() traverse the memory entry stack', async () => {
        const tr = await createTestRouter(routes, { url: '/' });
        await tr.navigate('/about');
        expect(tr.router.path).toBe('/about');

        await tr.back();
        expect(tr.router.path).toBe('/');

        await tr.forward();
        expect(tr.router.path).toBe('/about');
    });

    // The acceptance case for Jnana's two `vi.mock('rati')` files: with a real test router
    // mounted, <Link> works — no mock needed.
    test('a <Link> navigates against the test router, no mocks', async () => {
        const Nav: FC = () => (
            <div>
                home page <Link href="/about">go</Link>
            </div>
        );
        const tr = await createTestRouter([
            route('/', 'home', Nav),
            route('/about', 'about', AboutPage),
        ]);

        const anchor = tr.container.querySelector('a')!;
        expect(anchor.getAttribute('href')).toBe('/about');

        // The click alone must navigate — Link intercepts it and calls router.navigate.
        await act(async () => {
            anchor.click();
        });
        expect(tr.router.path).toBe('/about');
        expect(tr.text()).toBe('about page');
    });

    // The RF-01 dispose pin: a disposed harness detaches its history, so driving that history
    // afterwards is inert — no listener growth across sequential harnesses.
    test('dispose detaches the history (a disposed router stops reacting)', async () => {
        const tr = await createTestRouter(routes, { url: '/' });
        const { router, history } = tr;
        expect(router.path).toBe('/');

        tr.dispose();
        history.push('/about'); // the store unlistened; the memory history dropped its listeners
        expect(router.path).toBe('/');
    });
});

// The stores seam: a component reading two stores, rendered with a *partial* container and no
// `as unknown as GlobalStores` cast — the shape Jnana's ten fake-container tests build by hand.
interface FooStore {
    label: string;
}
interface BarStore {
    count: number;
}
interface AppStores extends GlobalStores {
    foo: FooStore;
    bar: BarStore;
}
const useAppStores = createUseStoresHook<AppStores>();

const TwoStoreReader: FC = () => {
    const { foo, bar } = useAppStores();
    return (
        <div>
            {foo.label}/{bar.count}
        </div>
    );
};

describe('renderWithStores', () => {
    test('injects a partial container the component reads — no cast', async () => {
        const handle = await renderWithStores<AppStores>(<TwoStoreReader />, {
            // Only the two stores this component reads, typed against AppStores — the router
            // (and any other store) is simply omitted. No `as unknown as` in sight.
            stores: { foo: { label: 'hi' }, bar: { count: 3 } },
        });
        expect(handle.text()).toBe('hi/3');
    });

    test('rerender keeps the stores provider (does not drop it)', async () => {
        const handle = await renderWithStores<AppStores>(<TwoStoreReader />, {
            stores: { foo: { label: 'a' }, bar: { count: 1 } },
        });
        // A bare mount re-render would render the new tree outside RootStoreProvider, and
        // useAppStores would throw; the handle re-wraps it.
        await handle.rerender(<TwoStoreReader />);
        expect(handle.text()).toBe('a/1');
    });
});

describe('createTestRouter — state', () => {
    test('seeds the initial entry state', async () => {
        const tr = await createTestRouter(routes, { url: '/', state: { panel: 'left' } });
        expect(tr.router.state).toEqual({ panel: 'left' });
    });
});
