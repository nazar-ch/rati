import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { lazy, FC } from 'react';
import { act, render, screen, cleanup } from '@testing-library/react';
import { WebRouterStore, route } from '../stores/WebRouterStore';
import { Router } from '../common/Router';
import { GenericStoresContext } from '../stores/RootStore';

const HomePage: FC = () => <div data-testid="home">home</div>;

beforeEach(() => {
    window.history.replaceState(null, '', 'http://localhost/');
});

afterEach(() => {
    cleanup();
});

interface RenderRouterOptions {
    routes: ReturnType<typeof route>[];
}

function renderWithRouter({ routes }: RenderRouterOptions) {
    const router = new WebRouterStore({}, routes);
    const stores = { router };
    const result = render(
        <GenericStoresContext.Provider value={stores}>
            <Router Loading={() => <div data-testid="loading">loading…</div>} />
        </GenericStoresContext.Provider>
    );
    return { router, ...result };
}

describe('Router + Suspense', () => {
    test('renders an eager component synchronously without showing Loading', async () => {
        const routes = [route('/', 'home', HomePage)];
        const { router } = renderWithRouter({ routes });
        // Let the constructor's setPath promise resolve.
        await act(async () => {
            await Promise.resolve();
        });
        expect(screen.getByTestId('home')).toBeDefined();
        expect(screen.queryByTestId('loading')).toBeNull();
        router.dispose();
    });

    test('renders Loading while a React.lazy component imports, then swaps in the chunk', async () => {
        // Resolver we control so we can step the import promise on demand.
        let resolveImport!: (mod: { default: FC }) => void;
        const importPromise = new Promise<{ default: FC }>((resolve) => {
            resolveImport = resolve;
        });
        const LazyPage = lazy(() => importPromise);
        const routes = [route('/', 'lazy', LazyPage)];

        const { router } = renderWithRouter({ routes });
        await act(async () => {
            await Promise.resolve();
        });

        // Suspense fallback is showing while the import is pending.
        expect(screen.getByTestId('loading')).toBeDefined();

        // Resolve the dynamic import; React mounts the real component.
        await act(async () => {
            resolveImport({
                default: () => <div data-testid="lazy-page">lazy content</div>,
            });
            await Promise.resolve();
        });

        expect(screen.getByTestId('lazy-page')).toBeDefined();
        expect(screen.queryByTestId('loading')).toBeNull();
        router.dispose();
    });

    test('shows fallback again on navigation to a different lazy route', async () => {
        let resolveA!: (mod: { default: FC }) => void;
        let resolveB!: (mod: { default: FC }) => void;
        const LazyA = lazy(
            () =>
                new Promise<{ default: FC }>((resolve) => {
                    resolveA = resolve;
                })
        );
        const LazyB = lazy(
            () =>
                new Promise<{ default: FC }>((resolve) => {
                    resolveB = resolve;
                })
        );

        const routes = [route('/', 'a', LazyA), route('/b', 'b', LazyB)];
        const { router } = renderWithRouter({ routes });
        await act(async () => {
            await Promise.resolve();
            resolveA({ default: () => <div data-testid="a">A</div> });
            await Promise.resolve();
        });

        expect(screen.getByTestId('a')).toBeDefined();

        // Navigate to /b — its import is still pending, so Loading appears.
        await act(async () => {
            router.history.push('/b');
            await Promise.resolve();
        });
        expect(screen.getByTestId('loading')).toBeDefined();

        await act(async () => {
            resolveB({ default: () => <div data-testid="b">B</div> });
            await Promise.resolve();
        });
        expect(screen.getByTestId('b')).toBeDefined();
        router.dispose();
    });
});
