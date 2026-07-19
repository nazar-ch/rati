import { describe, test, expect, afterEach } from 'vite-plus/test';
import { act, lazy, type FC } from 'react';
import { screen } from '@testing-library/react';
import { route } from '../../router/route';
import { Router } from '../../router/Router';
import { createTestRouter, cleanup } from '../../testing';

const HomePage: FC = () => <div data-testid="home">home</div>;

afterEach(cleanup);

// The route-level Suspense fallback (for a lazy chunk), tagged so the tests can see it.
const loadingRouter = <Router Loading={() => <div data-testid="loading">loading…</div>} />;

describe('Router + Suspense', () => {
    test('renders an eager component synchronously without showing Loading', async () => {
        await createTestRouter([route('/', 'home', HomePage)], { ui: loadingRouter });
        expect(screen.getByTestId('home')).toBeDefined();
        expect(screen.queryByTestId('loading')).toBeNull();
    });

    test('renders Loading while a React.lazy component imports, then swaps in the chunk', async () => {
        // Resolver we control so we can step the import promise on demand.
        let resolveImport!: (mod: { default: FC }) => void;
        const importPromise = new Promise<{ default: FC }>((resolve) => {
            resolveImport = resolve;
        });
        const LazyPage = lazy(() => importPromise);

        await createTestRouter([route('/', 'lazy', LazyPage)], { ui: loadingRouter });

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
    });

    test('keeps showing the previous page while the next lazy route loads (no fallback flash)', async () => {
        // Pre-resolve at construction so the factory captures the resolver
        // before being invoked. (Defining it inside the factory closure
        // would lose the ref once useDeferredValue defers the render.)
        let resolveB!: (mod: { default: FC }) => void;
        const importB = new Promise<{ default: FC }>((resolve) => {
            resolveB = resolve;
        });
        const LazyB = lazy(() => importB);

        const tr = await createTestRouter([route('/', 'home', HomePage), route('/b', 'b', LazyB)], {
            ui: loadingRouter,
        });
        expect(screen.getByTestId('home')).toBeDefined();

        // Navigate to /b. Its chunk is still pending — useDeferredValue keeps
        // the home page on screen instead of switching to the Suspense
        // fallback.
        await act(async () => {
            tr.router.history.push('/b');
            await Promise.resolve();
        });
        expect(screen.getByTestId('home')).toBeDefined();
        expect(screen.queryByTestId('loading')).toBeNull();

        await act(async () => {
            resolveB({ default: () => <div data-testid="b">B</div> });
            await Promise.resolve();
        });
        expect(screen.getByTestId('b')).toBeDefined();
        expect(screen.queryByTestId('home')).toBeNull();
    });
});
