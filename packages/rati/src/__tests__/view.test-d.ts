import { describe, test, expectTypeOf } from 'vitest';
import {
    createView,
    viewParam,
    type RequiredViewParams,
    type ResolveView,
} from '../common/view';

class TestStore {
    constructor(_params: { productName: string }) {}
    text = 'store';
}

describe('createView', () => {
    test('resolves params, promises, functions, classes and plain values', () => {
        const view = createView({
            productName: viewParam<string>(),
            count: Promise.resolve(1),
            load: async () => 'loaded',
            plain: 'plain',
        });

        expectTypeOf<ResolveView<typeof view>>().toEqualTypeOf<{
            productName: string;
            count: number;
            load: string;
            plain: string;
        }>();
    });

    test('passes resolved props of the previous view to functions and classes', () => {
        const base = createView({
            productName: viewParam<string>(),
            id: async () => 7,
        });

        const view = createView(base, {
            label: async (params) => {
                expectTypeOf(params).toEqualTypeOf<{ productName: string; id: number }>();
                return params.id;
            },
            store: TestStore,
        });

        expectTypeOf<ResolveView<typeof view>>().toEqualTypeOf<{
            productName: string;
            id: number;
            label: number;
            store: TestStore;
        }>();
    });

    test('collects viewParam props from the whole chain into RequiredViewParams', () => {
        const view = createView(createView({ productId: viewParam<number>() }), {
            productName: viewParam<string>(),
            load: async () => 'x',
        });

        expectTypeOf<RequiredViewParams<typeof view>>().toEqualTypeOf<{
            productId: number;
            productName: string;
        }>();
    });

    test('rejects functions whose params are not provided by previous views', () => {
        createView(createView({ a: viewParam<number>() }), {
            // @ts-expect-error - `b` is not provided by the previous views
            broken: (params: { b: string }) => params.b,
        });
    });
});

describe('createView.chain', () => {
    test('accumulates resolved props across chained views', () => {
        const view = createView
            .chain({ productName: viewParam<string>() })
            .chain({
                name: async (params) => {
                    expectTypeOf(params).toEqualTypeOf<{ productName: string }>();
                    return params.productName.length;
                },
            })
            .chain({ store: TestStore });

        expectTypeOf<ResolveView<typeof view>>().toEqualTypeOf<{
            productName: string;
            name: number;
            store: TestStore;
        }>();

        expectTypeOf<RequiredViewParams<typeof view>>().toEqualTypeOf<{
            productName: string;
        }>();
    });

    test('supports chains deeper than the old recursion limit of 9', () => {
        const view = createView
            .chain({ v1: viewParam<number>() })
            .chain({ v2: async () => 2 })
            .chain({ v3: async () => 3 })
            .chain({ v4: async () => 4 })
            .chain({ v5: async () => 5 })
            .chain({ v6: async () => 6 })
            .chain({ v7: async () => 7 })
            .chain({ v8: async () => 8 })
            .chain({ v9: async () => 9 })
            .chain({ v10: async () => 10 })
            .chain({ v11: async () => 11 })
            .chain({
                sum: async (params) => {
                    expectTypeOf(params.v1).toEqualTypeOf<number>();
                    expectTypeOf(params.v11).toEqualTypeOf<number>();
                    return params.v1 + params.v11;
                },
            });

        expectTypeOf<ResolveView<typeof view>['sum']>().toEqualTypeOf<number>();
        expectTypeOf<RequiredViewParams<typeof view>>().toEqualTypeOf<{ v1: number }>();
    });

    test('rejects chained functions whose params are not provided by previous views', () => {
        createView.chain({ a: viewParam<number>() }).chain({
            // @ts-expect-error - `b` is not provided by the previous views
            broken: (params: { b: string }) => params.b,
        });
    });
});
