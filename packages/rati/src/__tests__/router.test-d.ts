import { describe, test, expectTypeOf } from 'vitest';
import { ComponentType, FC } from 'react';
import { route, route2 } from '../stores/WebRouterStore';
import { createView, viewParam, ViewComponent } from '../common/view';
import { createIsland } from '../experimental/island';

const TestFC: FC = () => null;

const EmptyView = createView({});

describe('route()', () => {
    test('accepts a plain FC for a parameterless path', () => {
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
});

describe('route2()', () => {
    const ProductIsland = createIsland({
        useEnv: () => ({}),
        view: () => createView.chain({ productId: viewParam<string>() }),
        component: () => null,
        loading: () => null,
    });

    test('accepts a plain FC with no options and keeps literal types', () => {
        const r = route2('/', 'home', TestFC);
        expectTypeOf(r.name).toEqualTypeOf<'home'>();
        expectTypeOf(r.path).toEqualTypeOf<'/'>();
    });

    test('feeds an island from matching path params', () => {
        route2('/shop/:productId', 'product', ProductIsland);
    });

    test('rejects an island whose params are not present in the path', () => {
        // @ts-expect-error - "/" has no :productId param
        route2('/', 'home', ProductIsland);
    });

    test('accepts a view via options', () => {
        const C: ViewComponent<typeof EmptyView> = () => null;
        route2('/:productId', 'product', C, { view: EmptyView });
    });

    test('accepts a wrapper via options', () => {
        const Wrapper: ComponentType = TestFC;
        route2('/', 'home', TestFC, { wrapper: Wrapper });
    });

    test('rejects components that require params not present in the path', () => {
        const ProductFC: FC<{ productId: string }> = () => null;
        // @ts-expect-error - "/" has no :productId param
        route2('/', 'home', ProductFC);
    });
});
