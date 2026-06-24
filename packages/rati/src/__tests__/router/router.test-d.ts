import { describe, test, expectTypeOf } from 'vitest';
import { ComponentType, FC } from 'react';
import { route } from '../../router/route';
import { scope, prop, ScopeComponent } from '../../scope/scope';
import { island } from '../../island/island';

const TestFC: FC = () => null;

const EmptyScope = scope();

describe('route()', () => {
    const ProductIsland = island({
        scope: scope({ productId: prop<string>() }),
        component: () => null,
        loading: () => null,
    });

    test('accepts a plain FC for a parameterless path and keeps literal types', () => {
        const r = route('/', 'home', TestFC);
        expectTypeOf(r.name).toEqualTypeOf<'home'>();
        expectTypeOf(r.path).toEqualTypeOf<'/'>();
    });

    test('accepts a component that opts out of route params', () => {
        const C: ScopeComponent<typeof EmptyScope> = () => null;
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

    test('feeds an island whose params are branded (URL string refined by prop)', () => {
        type PageId = string & { readonly __brand: 'PageId' };
        const BrandedIsland = island({
            scope: scope({ pageId: prop<PageId>() }),
            component: () => null,
            loading: () => null,
        });
        // The path yields a plain string; the island brands it via prop(), so it's
        // accepted by param name even though `pageId` is a branded string.
        route('/pages/:pageId', 'page', BrandedIsland);
    });

    test('rejects an island whose params are not present in the path', () => {
        // @ts-expect-error - "/" has no :productId param
        route('/', 'home', ProductIsland);
    });

    test('accepts a scope via options', () => {
        const C: ScopeComponent<typeof EmptyScope> = () => null;
        route('/:productId', 'product', C, { scope: EmptyScope });
    });

    test('accepts a wrapper via options', () => {
        const Wrapper: ComponentType = TestFC;
        route('/', 'home', TestFC, { wrapper: Wrapper });
    });
});
