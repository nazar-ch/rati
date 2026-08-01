import { describe, test, expectTypeOf } from 'vite-plus/test';
import {
    scope,
    input,
    data,
    type LoadContext,
    type ScopeInputs,
    type ScopeProps,
} from '../../scope/scope';

class TestStore {
    constructor(_params: { productName: string }) {}
    text = 'store';
}

describe('scope', () => {
    test('resolves params, promises, functions, classes and plain values', () => {
        const scopeDef = scope({ productName: input<string>() }).load({
            count: Promise.resolve(1),
            load: async () => 'loaded',
            plain: 'plain',
        });

        expectTypeOf<ScopeProps<typeof scopeDef>>().toEqualTypeOf<{
            productName: string;
            count: number;
            load: string;
            plain: string;
        }>();
    });

    test('passes resolved props of prior levels to functions and classes', () => {
        const scopeDef = scope({ productName: input<string>() })
            .load({ id: async () => 7 })
            .load({
                label: async (params) => {
                    expectTypeOf(params).toEqualTypeOf<{ productName: string; id: number }>();
                    return params.id;
                },
                store: TestStore,
            });

        expectTypeOf<ScopeProps<typeof scopeDef>>().toEqualTypeOf<{
            productName: string;
            id: number;
            label: number;
            store: TestStore;
        }>();
    });

    test('collects input() inputs from the head into ScopeInputs', () => {
        const scopeDef = scope({
            productId: input<number>(),
            productName: input<string>(),
        }).load({ load: async () => 'x' });

        expectTypeOf<ScopeInputs<typeof scopeDef>>().toEqualTypeOf<{
            productId: number;
            productName: string;
        }>();
    });

    test('rejects loads whose params are not provided by prior levels', () => {
        scope({ a: input<number>() }).load({
            // @ts-expect-error - `b` is not provided by the prior levels
            broken: (params: { b: string }) => params.b,
        });
    });
});

describe('the load context (SI-01)', () => {
    test('a load taking it keeps the same props and return inference', () => {
        const scopeDef = scope({ productName: input<string>() })
            .load({ id: async () => 7 })
            .load({
                // Taking the second argument must cost nothing on the first: the props bag
                // is still the prior levels' resolved values, and the return still unwraps.
                label: async (params, context) => {
                    expectTypeOf(params).toEqualTypeOf<{ productName: string; id: number }>();
                    expectTypeOf(context).toEqualTypeOf<LoadContext>();
                    expectTypeOf(context.signal).toEqualTypeOf<AbortSignal>();
                    return params.id;
                },
            });

        expectTypeOf<ScopeProps<typeof scopeDef>>().toEqualTypeOf<{
            productName: string;
            id: number;
            label: number;
        }>();
    });

    test('a data() load takes it too', () => {
        const scopeDef = scope({ productName: input<string>() }).load({
            label: data((_params, context) => {
                expectTypeOf(context).toEqualTypeOf<LoadContext>();
                return Promise.resolve(1);
            }),
        });

        expectTypeOf<ScopeProps<typeof scopeDef>['label']>().toEqualTypeOf<number>();
    });

    test('declaring it is optional — a one-argument load is unchanged', () => {
        const scopeDef = scope({ productName: input<string>() }).load({
            label: async (params) => {
                expectTypeOf(params).toEqualTypeOf<{ productName: string }>();
                return params.productName.length;
            },
        });

        expectTypeOf<ScopeProps<typeof scopeDef>['label']>().toEqualTypeOf<number>();
    });
});

describe('scope().load()', () => {
    test('accumulates resolved props across dependent levels', () => {
        const scopeDef = scope({ productName: input<string>() })
            .load({
                name: async (params) => {
                    expectTypeOf(params).toEqualTypeOf<{ productName: string }>();
                    return params.productName.length;
                },
            })
            .load({ store: TestStore });

        expectTypeOf<ScopeProps<typeof scopeDef>>().toEqualTypeOf<{
            productName: string;
            name: number;
            store: TestStore;
        }>();

        expectTypeOf<ScopeInputs<typeof scopeDef>>().toEqualTypeOf<{
            productName: string;
        }>();
    });

    test('supports chains deeper than the old recursion limit of 9', () => {
        const scopeDef = scope({ v1: input<number>() })
            .load({ v2: async () => 2 })
            .load({ v3: async () => 3 })
            .load({ v4: async () => 4 })
            .load({ v5: async () => 5 })
            .load({ v6: async () => 6 })
            .load({ v7: async () => 7 })
            .load({ v8: async () => 8 })
            .load({ v9: async () => 9 })
            .load({ v10: async () => 10 })
            .load({ v11: async () => 11 })
            .load({
                sum: async (params) => {
                    expectTypeOf(params.v1).toEqualTypeOf<number>();
                    expectTypeOf(params.v11).toEqualTypeOf<number>();
                    return params.v1 + params.v11;
                },
            });

        expectTypeOf<ScopeProps<typeof scopeDef>['sum']>().toEqualTypeOf<number>();
        expectTypeOf<ScopeInputs<typeof scopeDef>>().toEqualTypeOf<{ v1: number }>();
    });

    test('rejects dependent loads whose params are not provided by prior levels', () => {
        scope({ a: input<number>() }).load({
            // @ts-expect-error - `b` is not provided by the prior levels
            broken: (params: { b: string }) => params.b,
        });
    });
});
