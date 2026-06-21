import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { Component, type FC, type ReactNode } from 'react';
import { act, render, screen, cleanup } from '@testing-library/react';
import { WebRouterStore, route2, type GenericRouteType } from '../stores/WebRouterStore';
import { Router } from '../common/Router';
import { GenericStoresContext } from '../stores/RootStore';
import { createView, viewParam, type ViewComponent } from '../common/view';
import { SourceSymbol, type Source } from '../common/source';
import { createIsland, useIslandProps } from '../experimental/island';

beforeEach(() => {
    window.history.replaceState(null, '', 'http://localhost/');
});

afterEach(cleanup);

function renderWithRouter(routes: readonly GenericRouteType[]) {
    const router = new WebRouterStore({}, routes);
    const stores = { router };
    const result = render(
        <GenericStoresContext.Provider value={stores}>
            <Router Loading={() => <div>route loading…</div>} />
        </GenericStoresContext.Provider>
    );
    return { router, ...result };
}

const Home: FC = () => <div>home</div>;
const IslandLoading: FC = () => <div>island loading…</div>;

type TestEnv = { tag: string };

describe('route2 + islands', () => {
    test('an island route resolves its waterfall from path params', async () => {
        const Product = createIsland({
            useEnv: () => ({ tag: 'env' }) as TestEnv,
            view: (env) =>
                createView
                    .chain({ productId: viewParam<string>() })
                    .chain({ label: async ({ productId }) => `${env.tag}:${productId}` }),
            component: ({ label }) => <div>product {label}</div>,
            loading: IslandLoading,
        });

        window.history.replaceState(null, '', '/products/42');
        const { router } = renderWithRouter([
            route2('/products/:productId', 'product', Product),
            route2('*', 'home', Home),
        ]);

        expect(screen.getByText('island loading…')).toBeTruthy();
        expect(await screen.findByText('product env:42')).toBeTruthy();
        router.dispose();
    });

    test('navigating away from an island route detaches its sources', async () => {
        const log: string[] = [];

        const Product = createIsland({
            useEnv: () => ({ tag: 'env' }) as TestEnv,
            view: () =>
                createView.chain({ productId: viewParam<string>() }).chain({
                    res: ({ productId }): Source<{ productId: string }> => ({
                        [SourceSymbol]: true,
                        state: { status: 'ready', value: { productId } },
                        attach() {
                            log.push(`attach:${productId}`);
                            return () => log.push(`detach:${productId}`);
                        },
                    }),
                }),
            component: ({ res }) => <div>product {res.productId}</div>,
            loading: IslandLoading,
        });

        window.history.replaceState(null, '', '/products/42');
        const { router } = renderWithRouter([
            route2('/products/:productId', 'product', Product),
            route2('*', 'home', Home),
        ]);

        await screen.findByText('product 42');
        expect(log).toEqual(['attach:42']);

        act(() => {
            router.navigate('/');
        });

        expect(await screen.findByText('home')).toBeTruthy();
        expect(log).toEqual(['attach:42', 'detach:42']);
        router.dispose();
    });

    test('options.view goes through the existing ViewLoader path', async () => {
        const homeView = createView({ greeting: async () => 'hello' });
        const HomeWithView: ViewComponent<typeof homeView> = ({ greeting }) => (
            <div>view says {greeting}</div>
        );

        const { router } = renderWithRouter([route2('/', 'home', HomeWithView, { view: homeView })]);

        expect(await screen.findByText('view says hello')).toBeTruthy();
        router.dispose();
    });

    test('options.wrapper renders around the route component', async () => {
        const Frame: FC<{ children?: ReactNode }> = ({ children }) => (
            <section aria-label="frame">{children}</section>
        );

        const { router } = renderWithRouter([route2('/', 'home', Home, { wrapper: Frame })]);

        const frame = await screen.findByLabelText('frame');
        expect(frame.textContent).toBe('home');
        router.dispose();
    });
});

describe('island auto-context', () => {
    test('useIslandProps reads resolved props anywhere under the island', async () => {
        const DeepChild: FC = () => {
            const { label } = useIslandProps(Product);
            return <div>from context: {label}</div>;
        };

        const Product = createIsland({
            useEnv: () => ({ tag: 'env' }) as TestEnv,
            view: () =>
                createView
                    .chain({ productId: viewParam<string>() })
                    .chain({ label: async ({ productId }) => `#${productId}` }),
            component: () => (
                <div>
                    <DeepChild />
                </div>
            ),
            loading: IslandLoading,
            provideContext: true,
        });

        render(<Product productId="42" />);

        expect(await screen.findByText('from context: #42')).toBeTruthy();
    });

    test('useIslandProps throws a helpful error when context is not provided', async () => {
        const Child: FC = () => {
            const props = useIslandProps(Product);
            return <div>{String(props)}</div>;
        };

        // No provideContext here
        const Product = createIsland({
            useEnv: () => ({ tag: 'env' }) as TestEnv,
            view: () => createView.chain({ productId: viewParam<string>() }),
            component: () => <Child />,
            loading: IslandLoading,
        });

        class Boundary extends Component<{ children: ReactNode }, { message: string | null }> {
            override state = { message: null };
            static getDerivedStateFromError(error: Error) {
                return { message: error.message };
            }
            override render() {
                return this.state.message ? (
                    <div>caught: {this.state.message}</div>
                ) : (
                    this.props.children
                );
            }
        }

        // React logs the caught error; keep the test output clean
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        try {
            render(
                <Boundary>
                    <Product productId="42" />
                </Boundary>
            );
            expect(await screen.findByText(/caught: No island props found/)).toBeTruthy();
        } finally {
            consoleError.mockRestore();
        }
    });
});
