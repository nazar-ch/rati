import { describe, test, expect } from 'vitest';
import { createView, resolveView, viewParam } from '../common/view';

class TestStore {
    constructor(params: { productName: string }) {
        this.text = `store:${params.productName}`;
    }

    text;
}

describe('resolveView', () => {
    test('resolves params, promises, functions, classes and plain values', async () => {
        const view = createView({
            productName: viewParam<string>(),
            count: Promise.resolve(1),
            load: async () => 'loaded',
            plain: 'plain',
        });

        const resolved = await resolveView(view, { productName: 'book' });

        expect(resolved).toEqual({
            productName: 'book',
            count: 1,
            load: 'loaded',
            plain: 'plain',
        });
    });

    test('resolves views created with createView(prevView, definition)', async () => {
        const base = createView({
            productName: viewParam<string>(),
            id: async () => 7,
        });

        const view = createView(base, {
            label: async (params) => `${params.productName}#${params.id}`,
            store: TestStore,
        });

        const resolved = await resolveView(view, { productName: 'book' });

        expect(resolved.label).toBe('book#7');
        expect(resolved.store.text).toBe('store:book');
    });

    test('resolves chained views level by level', async () => {
        const order: string[] = [];

        const view = createView
            .chain({ productName: viewParam<string>() })
            .chain({
                name: async (params) => {
                    order.push('name');
                    return `name:${params.productName}`;
                },
            })
            .chain({
                label: async (params) => {
                    order.push('label');
                    return `label:${params.name}`;
                },
            });

        const resolved = await resolveView(view, { productName: 'book' });

        expect(resolved).toEqual({
            productName: 'book',
            name: 'name:book',
            label: 'label:name:book',
        });
        expect(order).toEqual(['name', 'label']);
    });
});
