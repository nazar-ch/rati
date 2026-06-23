import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { Component, type FC, type ReactNode } from 'react';
import { act, render, screen, cleanup } from '@testing-library/react';
import { WebRouterStore, route, type GenericRouteType } from '../stores/WebRouterStore';
import { Router } from '../common/Router';
import { GenericStoresContext } from '../stores/RootStore';
import { scope, prop, type ScopeComponent } from '../common/scope';
import { SourceSymbol, type Source } from '../common/source';
import { island, useScope } from '../experimental/island';
import { useRouteContext } from '../common/useRouteContext';

// Register the 'product' route's context type so `useRouteContext('product')` is
// typed with no type argument — the same augmentation an app declares on `rati`.
declare module '../stores/WebRouterStore' {
    interface RatiRouteContexts {
        product: { label: string };
    }
}

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

// A promise the test resolves by hand, so a suspended (Suspense) render can be
// observed in its loading state before the value lands.
function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((res) => {
        resolve = res;
    });
    return { promise, resolve };
}

const Home: FC = () => <div>home</div>;
const IslandLoading: FC = () => <div>island loading…</div>;

type TestEnv = { tag: string };

describe('route + islands', () => {
    test('an island route resolves its waterfall from path params', async () => {
        const label = deferred<string>();
        const Product = island({
            useEnv: () => ({ tag: 'env' }) as TestEnv,
            scope: () =>
                scope({ productId: prop<string>() })
                    .load({ label: () => label.promise }),
            component: ({ label }) => <div>product {label}</div>,
            loading: IslandLoading,
        });

        window.history.replaceState(null, '', '/products/42');
        let router!: WebRouterStore<readonly GenericRouteType[]>;
        await act(async () => {
            ({ router } = renderWithRouter([
                route('/products/:productId', 'product', Product),
                route('*', 'home', Home),
            ]));
        });

        expect(screen.getByText('island loading…')).toBeTruthy();
        await act(async () => {
            label.resolve('env:42');
        });
        expect(await screen.findByText('product env:42')).toBeTruthy();
        router.dispose();
    });

    test('navigating away from an island route detaches its sources', async () => {
        const log: string[] = [];

        const Product = island({
            useEnv: () => ({ tag: 'env' }) as TestEnv,
            scope: () =>
                scope({ productId: prop<string>() }).load({
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
            route('/products/:productId', 'product', Product),
            route('*', 'home', Home),
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

    test('options.view resolves through the island engine (loading slot, then content)', async () => {
        const greeting = deferred<string>();
        const homeView = scope().load({ greeting: () => greeting.promise });
        const HomeWithView: ScopeComponent<typeof homeView> = ({ greeting }) => (
            <div>view says {greeting}</div>
        );

        let router!: WebRouterStore<readonly GenericRouteType[]>;
        await act(async () => {
            ({ router } = renderWithRouter([
                route('/', 'home', HomeWithView, {
                    scope: homeView,
                    loading: () => <div>resolving…</div>,
                }),
            ]));
        });

        // The per-route loading slot is the Suspense fallback while the promise
        // entry resolves — proof route runs on the island engine (the old
        // ViewLoader path had no per-route loading slot).
        expect(screen.getByText('resolving…')).toBeTruthy();
        await act(async () => {
            greeting.resolve('hello');
        });
        expect(await screen.findByText('view says hello')).toBeTruthy();
        router.dispose();
    });

    test('options.error renders the island error slot on failure', async () => {
        const failView = scope().load({
            data: async (): Promise<string> => {
                throw new Error('boom');
            },
        });
        const FailComponent: ScopeComponent<typeof failView> = ({ data }) => <div>{data}</div>;

        let router!: WebRouterStore<readonly GenericRouteType[]>;
        await act(async () => {
            ({ router } = renderWithRouter([
                route('/', 'home', FailComponent, {
                    scope: failView,
                    error: ({ error }) => <div>error: {error.code}</div>,
                }),
            ]));
        });

        // A throwing view function maps to a SourceError (code 'failed'); the
        // island renders the route's error slot instead of the component.
        expect(await screen.findByText('error: failed')).toBeTruthy();
        router.dispose();
    });

    test('options.wrapper renders around the route component', async () => {
        const Frame: FC<{ children?: ReactNode }> = ({ children }) => (
            <section aria-label="frame">{children}</section>
        );

        const { router } = renderWithRouter([route('/', 'home', Home, { wrapper: Frame })]);

        const frame = await screen.findByLabelText('frame');
        expect(frame.textContent).toBe('home');
        router.dispose();
    });

    test('useRouteContext reads a route island context by route name', async () => {
        // The view ends in `.provide()`; route builds the island, so there is no
        // island component to import — the subtree reads the context by route name.
        const productView = scope({ productId: prop<string>() })
            .provide(({ productId }) => ({ label: `#${productId}` }));

        const Deep: FC = () => {
            const { label } = useRouteContext('product');
            return <div>ctx {label}</div>;
        };
        const ProductBody: ScopeComponent<typeof productView> = () => <Deep />;

        window.history.replaceState(null, '', '/products/7');
        const { router } = renderWithRouter([
            route('/products/:productId', 'product', ProductBody, { scope: productView }),
            route('*', 'home', Home),
        ]);

        expect(await screen.findByText('ctx #7')).toBeTruthy();
        router.dispose();
    });
});

describe('island auto-context', () => {
    test('useScope reads resolved props anywhere under the island', async () => {
        const DeepChild: FC = () => {
            const { label } = useScope(Product);
            return <div>from context: {label}</div>;
        };

        const Product = island({
            useEnv: () => ({ tag: 'env' }) as TestEnv,
            scope: () =>
                scope({ productId: prop<string>() })
                    .load({ label: async ({ productId }) => `#${productId}` }),
            component: () => (
                <div>
                    <DeepChild />
                </div>
            ),
            loading: IslandLoading,
        });

        await act(async () => {
            render(<Product productId="42" />);
        });

        expect(await screen.findByText('from context: #42')).toBeTruthy();
    });

    test('useScope throws a helpful error when rendered outside the island', async () => {
        // A valid island (so the channel exists), but the reader is rendered with no
        // <Product> ancestor — so there is no provided value above it.
        const Product = island({
            useEnv: () => ({ tag: 'env' }) as TestEnv,
            scope: () => scope({ productId: prop<string>() }),
            component: () => null,
            loading: IslandLoading,
        });

        const Child: FC = () => {
            const props = useScope(Product);
            return <div>{String(props)}</div>;
        };

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
                    <Child />
                </Boundary>
            );
            expect(await screen.findByText(/caught: No scope value found/)).toBeTruthy();
        } finally {
            consoleError.mockRestore();
        }
    });
});
