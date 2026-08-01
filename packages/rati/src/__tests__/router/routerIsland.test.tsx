import { describe, test, expect, afterEach, vi } from 'vite-plus/test';
import { act, Component, type FC, type ReactNode } from 'react';
// RTL is kept for the island-auto-context block below — those render an island (or a bare
// reader) directly, not a router. The router tests use createTestRouter.
import { render, screen, cleanup as rtlCleanup } from '@testing-library/react';
import { route } from '../../router/route';
import { scope, input, type ScopeComponent } from '../../scope/scope';
import { island } from '../../island/island';
import { useScope } from '../../mandala/channel';
import { useRouteContext } from '../../router/useRouteContext';
import { controllableSource, createTestRouter, deferred, cleanup } from '../../testing';

// The 'product' route's context type is registered globally via the app-routes
// augmentation in `routeContext.test-d.ts` (`RatiUserTypes['routes']`), so the
// `useRouteContext('product')` call below is typed straight off the route's scope —
// no separate context registration.

afterEach(() => {
    cleanup();
    rtlCleanup();
});

const Home: FC = () => <div>home</div>;
const IslandLoading: FC = () => <div>island loading…</div>;

describe('route + islands', () => {
    test('an island route resolves its waterfall from path params', async () => {
        const label = deferred<string>();
        const Product = island({
            scope: scope({ productId: input<string>() }).load({ label: () => label.promise }),
            component: ({ label }) => <div>product {label}</div>,
            loading: IslandLoading,
        });

        await createTestRouter(
            [route('/products/:productId', 'product', Product), route('*', 'home', Home)],
            { url: '/products/42' },
        );

        expect(screen.getByText('island loading…')).toBeTruthy();
        await act(async () => {
            label.resolve('env:42');
        });
        expect(await screen.findByText('product env:42')).toBeTruthy();
    });

    test('navigating away from an island route detaches its sources', async () => {
        const log: string[] = [];

        const Product = island({
            scope: scope({ productId: input<string>() }).load({
                res: ({ productId }) =>
                    controllableSource({
                        initial: { productId },
                        onAttach: () => log.push(`attach:${productId}`),
                        onDetach: () => log.push(`detach:${productId}`),
                    }),
            }),
            component: ({ res }) => <div>product {res.productId}</div>,
            loading: IslandLoading,
        });

        const tr = await createTestRouter(
            [route('/products/:productId', 'product', Product), route('*', 'home', Home)],
            { url: '/products/42' },
        );

        await screen.findByText('product 42');
        expect(log).toEqual(['attach:42']);

        await tr.navigate('/');

        expect(await screen.findByText('home')).toBeTruthy();
        expect(log).toEqual(['attach:42', 'detach:42']);
    });

    test('options.scope resolves through the island engine (loading slot, then content)', async () => {
        const greeting = deferred<string>();
        const homeScope = scope().load({ greeting: () => greeting.promise });
        const HomeWithScope: ScopeComponent<typeof homeScope> = ({ greeting }) => (
            <div>scope says {greeting}</div>
        );

        await createTestRouter([
            route('/', 'home', HomeWithScope, {
                scope: homeScope,
                loading: () => <div>resolving…</div>,
            }),
        ]);

        // The per-route loading slot is the Suspense fallback while the promise
        // entry resolves — proof route runs on the island engine (the
        // old route-loader path had no per-route loading slot).
        expect(screen.getByText('resolving…')).toBeTruthy();
        await act(async () => {
            greeting.resolve('hello');
        });
        expect(await screen.findByText('scope says hello')).toBeTruthy();
    });

    test('options.error renders the island error slot on failure', async () => {
        const failScope = scope().load({
            data: async (): Promise<string> => {
                throw new Error('boom');
            },
        });
        const FailComponent: ScopeComponent<typeof failScope> = ({ data }) => <div>{data}</div>;

        await createTestRouter([
            route('/', 'home', FailComponent, {
                scope: failScope,
                error: ({ error }) => <div>error: {error.code}</div>,
            }),
        ]);

        // A throwing load function maps to a SourceError (code 'failed'); the
        // island renders the route's error slot instead of the component.
        expect(await screen.findByText('error: failed')).toBeTruthy();
    });

    test('options.wrapper renders around the route component', async () => {
        const Frame: FC<{ children?: ReactNode }> = ({ children }) => (
            <section aria-label="frame">{children}</section>
        );

        await createTestRouter([route('/', 'home', Home, { wrapper: Frame })]);

        const frame = await screen.findByLabelText('frame');
        expect(frame.textContent).toBe('home');
    });

    test('useRouteContext reads a route island context by route name', async () => {
        // The scope ends in `.provide()`; route builds the island, so there is no
        // island component to import — the subtree reads the context by route name.
        const productScope = scope({ productId: input<string>() }).provide(({ productId }) => ({
            label: `#${productId}`,
        }));

        const Deep: FC = () => {
            const { label } = useRouteContext('product');
            return <div>ctx {label}</div>;
        };
        const ProductBody: ScopeComponent<typeof productScope> = () => <Deep />;

        await createTestRouter(
            [
                route('/products/:productId', 'product', ProductBody, { scope: productScope }),
                route('*', 'home', Home),
            ],
            { url: '/products/7' },
        );

        expect(await screen.findByText('ctx #7')).toBeTruthy();
    });
});

describe('island auto-context', () => {
    test('useScope reads resolved props anywhere under the island', async () => {
        const productScope = scope({ productId: input<string>() }).load({
            label: async ({ productId }) => `#${productId}`,
        });

        const DeepChild: FC = () => {
            const { label } = useScope(productScope);
            return <div>from context: {label}</div>;
        };

        const Product = island({
            scope: productScope,
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
        // A valid island (so the scope's channel exists), but the reader is rendered with
        // no <Product> ancestor — so there is no provided value above it.
        const productScope = scope({ productId: input<string>() });
        island({ scope: productScope, component: () => null, loading: IslandLoading });

        const Child: FC = () => {
            const props = useScope(productScope);
            return <div>{JSON.stringify(props)}</div>;
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
                </Boundary>,
            );
            expect(
                await screen.findByText(/caught: .*no island for this scope is above/),
            ).toBeTruthy();
        } finally {
            consoleError.mockRestore();
        }
    });
});
