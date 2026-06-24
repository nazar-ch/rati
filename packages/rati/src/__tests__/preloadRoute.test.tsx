import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { FC } from 'react';
import { act, render, fireEvent, cleanup } from '@testing-library/react';
import { WebRouterStore } from '../router/store';
import { route } from '../router/route';
import { lazy } from '../router/lazy';
import { Link } from '../router/Link';
import { GenericStoresContext } from '../stores/RootStore';

const NoopComponent: FC = () => null;

beforeEach(() => {
    window.history.replaceState(null, '', 'http://localhost/');
});

afterEach(() => {
    cleanup();
});

describe('WebRouterStore.preloadRoute', () => {
    test('returns undefined for an eager (non-lazy) component', () => {
        const routes = [route('/', 'home', NoopComponent)];
        const router = new WebRouterStore({}, routes);
        expect(router.preloadRoute('/')).toBeUndefined();
        router.dispose();
    });

    test('invokes the lazy factory exactly once even with repeated calls', async () => {
        const factory = vi.fn(async () => ({ default: NoopComponent }));
        const Page = lazy(factory);
        const routes = [route('/page', 'page', Page)];
        const router = new WebRouterStore({}, routes);

        await router.preloadRoute('/page');
        await router.preloadRoute('/page');
        await router.preloadRoute('/page');

        expect(factory).toHaveBeenCalledOnce();
        router.dispose();
    });

    test('matches parameterized routes', async () => {
        const factory = vi.fn(async () => ({ default: NoopComponent }));
        const Page = lazy(factory);
        const routes = [route('/users/:id', 'user', Page)];
        const router = new WebRouterStore({}, routes);

        await router.preloadRoute('/users/42');
        expect(factory).toHaveBeenCalledOnce();
        router.dispose();
    });

    test('strips query and hash before matching', async () => {
        const factory = vi.fn(async () => ({ default: NoopComponent }));
        const Page = lazy(factory);
        const routes = [route('/page', 'page', Page)];
        const router = new WebRouterStore({}, routes);

        await router.preloadRoute('/page?q=1#section');
        expect(factory).toHaveBeenCalledOnce();
        router.dispose();
    });

    test('respects basename when matching', async () => {
        const factory = vi.fn(async () => ({ default: NoopComponent }));
        const Page = lazy(factory);
        const routes = [route('/page', 'page', Page)];
        const router = new WebRouterStore({}, routes, { basename: '/admin' });

        // Caller passes the URL-as-rendered (with basename), as `<Link>` does.
        await router.preloadRoute('/admin/page');
        expect(factory).toHaveBeenCalledOnce();
        router.dispose();
    });
});

describe('<Link prefetch>', () => {
    function renderLink(opts: {
        routes: ReturnType<typeof route>[];
        prefetch: boolean;
        href: string;
    }) {
        const router = new WebRouterStore({}, opts.routes);
        const stores = { router };
        const utils = render(
            <GenericStoresContext.Provider value={stores}>
                <Link href={opts.href} prefetch={opts.prefetch}>
                    go
                </Link>
            </GenericStoresContext.Provider>
        );
        return { router, ...utils };
    }

    test('prefetch=true triggers preload on mouse enter', async () => {
        const factory = vi.fn(async () => ({ default: NoopComponent }));
        const Page = lazy(factory);
        const { container, router } = renderLink({
            routes: [route('/page', 'page', Page)],
            prefetch: true,
            href: '/page',
        });

        await act(async () => {
            fireEvent.mouseEnter(container.querySelector('a')!);
        });
        expect(factory).toHaveBeenCalledOnce();
        router.dispose();
    });

    test('prefetch=true triggers preload on touch start', async () => {
        const factory = vi.fn(async () => ({ default: NoopComponent }));
        const Page = lazy(factory);
        const { container, router } = renderLink({
            routes: [route('/page', 'page', Page)],
            prefetch: true,
            href: '/page',
        });

        await act(async () => {
            fireEvent.touchStart(container.querySelector('a')!);
        });
        expect(factory).toHaveBeenCalledOnce();
        router.dispose();
    });

    test('prefetch defaults to off — hover does NOT trigger import', async () => {
        const factory = vi.fn(async () => ({ default: NoopComponent }));
        const Page = lazy(factory);
        const { container, router } = renderLink({
            routes: [route('/page', 'page', Page)],
            prefetch: false,
            href: '/page',
        });

        await act(async () => {
            fireEvent.mouseEnter(container.querySelector('a')!);
        });
        expect(factory).not.toHaveBeenCalled();
        router.dispose();
    });
});
