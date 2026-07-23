import { describe, test, expect, beforeEach, afterEach, vi } from 'vite-plus/test';
import { type FC } from 'react';
import { act, fireEvent } from '@testing-library/react';
import { RouterStore } from '../../router/store';
import { route } from '../../router/route';
import { lazy } from '../../router/lazy';
import { Link } from '../../router/Link';
import { createTestRouter, cleanup } from '../../testing';

const NoopComponent: FC = () => null;

beforeEach(() => {
    window.history.replaceState(null, '', 'http://localhost/');
});

afterEach(() => {
    cleanup();
});

describe('RouterStore.preloadRoute', () => {
    test('returns undefined for an eager (non-lazy) component', () => {
        const routes = [route('/', 'home', NoopComponent)];
        const router = new RouterStore({}, routes);
        expect(router.preloadRoute('/')).toBeUndefined();
        router.dispose();
    });

    test('invokes the lazy factory exactly once even with repeated calls', async () => {
        const factory = vi.fn(async () => ({ default: NoopComponent }));
        const Page = lazy(factory);
        const routes = [route('/page', 'page', Page)];
        const router = new RouterStore({}, routes);

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
        const router = new RouterStore({}, routes);

        await router.preloadRoute('/users/42');
        expect(factory).toHaveBeenCalledOnce();
        router.dispose();
    });

    test('strips query and hash before matching', async () => {
        const factory = vi.fn(async () => ({ default: NoopComponent }));
        const Page = lazy(factory);
        const routes = [route('/page', 'page', Page)];
        const router = new RouterStore({}, routes);

        await router.preloadRoute('/page?q=1#section');
        expect(factory).toHaveBeenCalledOnce();
        router.dispose();
    });

    test('respects basename when matching', async () => {
        const factory = vi.fn(async () => ({ default: NoopComponent }));
        const Page = lazy(factory);
        const routes = [route('/page', 'page', Page)];
        const router = new RouterStore({}, routes, { basename: '/admin' });

        // Caller passes the URL-as-rendered (with basename), as `<Link>` does.
        await router.preloadRoute('/admin/page');
        expect(factory).toHaveBeenCalledOnce();
        router.dispose();
    });
});

describe('<Link prefetch>', () => {
    // A real test router mounted around the bare <Link> (its `ui`) — the prefetch handlers
    // read the router from the store, no GenericStoresContext hand-wiring. cleanup() disposes.
    function renderLink(opts: {
        routes: ReturnType<typeof route>[];
        prefetch: boolean;
        href: string;
    }) {
        return createTestRouter(opts.routes, {
            ui: (
                <Link href={opts.href} prefetch={opts.prefetch}>
                    go
                </Link>
            ),
        });
    }

    test('prefetch=true triggers preload on mouse enter', async () => {
        const factory = vi.fn(async () => ({ default: NoopComponent }));
        const Page = lazy(factory);
        const { container } = await renderLink({
            routes: [route('/page', 'page', Page)],
            prefetch: true,
            href: '/page',
        });

        await act(async () => {
            fireEvent.mouseEnter(container.querySelector('a')!);
        });
        expect(factory).toHaveBeenCalledOnce();
    });

    test('prefetch=true triggers preload on touch start', async () => {
        const factory = vi.fn(async () => ({ default: NoopComponent }));
        const Page = lazy(factory);
        const { container } = await renderLink({
            routes: [route('/page', 'page', Page)],
            prefetch: true,
            href: '/page',
        });

        await act(async () => {
            fireEvent.touchStart(container.querySelector('a')!);
        });
        expect(factory).toHaveBeenCalledOnce();
    });

    test('prefetch defaults to off — hover does NOT trigger import', async () => {
        const factory = vi.fn(async () => ({ default: NoopComponent }));
        const Page = lazy(factory);
        const { container } = await renderLink({
            routes: [route('/page', 'page', Page)],
            prefetch: false,
            href: '/page',
        });

        await act(async () => {
            fireEvent.mouseEnter(container.querySelector('a')!);
        });
        expect(factory).not.toHaveBeenCalled();
    });
});
