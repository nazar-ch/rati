import { describe, test, expectTypeOf } from 'vitest';
import { FC } from 'react';
import { route } from '../stores/WebRouterStore';
import { createView, ViewComponent } from '../common/view';

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
