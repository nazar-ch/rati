import { describe, test, expectTypeOf } from 'vitest';
import { ComponentType, FC } from 'react';
import { route } from '../stores/WebRouterStore';
import { createView, viewParam, ViewComponent } from '../common/view';
import { createIsland } from '../experimental/island';

const TestFC: FC = () => null;

const EmptyView = createView({});

describe('route()', () => {
    const ProductIsland = createIsland({
        useEnv: () => ({}),
        view: () => createView.chain({ productId: viewParam<string>() }),
        component: () => null,
        loading: () => null,
    });

    test('accepts a plain FC for a parameterless path and keeps literal types', () => {
        const r = route('/', 'home', TestFC);
        expectTypeOf(r.name).toEqualTypeOf<'home'>();
        expectTypeOf(r.path).toEqualTypeOf<'/'>();
    });

    test('accepts a component that opts out of route params', () => {
        const C: ViewComponent<typeof EmptyView> = () => null;
        route('/:productId', 'product', C);
    });

    test('rejects components that require params not present in the path', () => {
        const ProductFC: FC<{ productId: string }> = () => null;
        // @ts-expect-error - "/" has no :productId param
        route('/', 'home', ProductFC);
    });

    test('accepts components whose props match the route params', () => {
        const ProductFC: FC<{ productId: string }> = () => null;
        route('/shop/:productId', 'product', ProductFC);
    });

    test('feeds an island from matching path params', () => {
        route('/shop/:productId', 'product', ProductIsland);
    });

    test('feeds an island whose params are branded (URL string refined by viewParam)', () => {
        type PageId = string & { readonly __brand: 'PageId' };
        const BrandedIsland = createIsland({
            useEnv: () => ({}),
            view: () => createView.chain({ pageId: viewParam<PageId>() }),
            component: () => null,
            loading: () => null,
        });
        // The path yields a plain string; the island brands it via viewParam, so
        // it's accepted by param name even though `pageId` is a branded string.
        route('/pages/:pageId', 'page', BrandedIsland);
    });

    test('rejects an island whose params are not present in the path', () => {
        // @ts-expect-error - "/" has no :productId param
        route('/', 'home', ProductIsland);
    });

    test('accepts a view via options', () => {
        const C: ViewComponent<typeof EmptyView> = () => null;
        route('/:productId', 'product', C, { view: EmptyView });
    });

    test('accepts a wrapper via options', () => {
        const Wrapper: ComponentType = TestFC;
        route('/', 'home', TestFC, { wrapper: Wrapper });
    });
});
