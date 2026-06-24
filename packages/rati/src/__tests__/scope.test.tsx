import { describe, test, expect, afterEach } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import { scope, prop, type Scope } from '../scope/scope';
import { island } from '../island/island';

afterEach(cleanup);

class TestStore {
    text: string;
    constructor(params: { productName: string }) {
        this.text = `store:${params.productName}`;
    }
}

// A scope resolves at render time inside the island engine. Render a throwaway island
// over `scopeDef` and capture the resolved props its component receives, so these
// exercise the resolution matrix (params, raw promises, functions, classes, plain
// values, dependent levels) through the engine.
async function resolveThroughIsland(
    scopeDef: Scope<any>,
    params: Record<string, unknown>
): Promise<Record<string, unknown>> {
    let received: Record<string, unknown> | undefined;
    const Island = island({
        scope: scopeDef,
        component: (props: Record<string, unknown>) => {
            received = props;
            return <div>ready</div>;
        },
        loading: () => <div>loading</div>,
    });

    await act(async () => {
        render(<Island {...params} />);
    });
    await screen.findByText('ready');
    return received!;
}

describe('scope resolution through the island engine', () => {
    test('resolves params, raw promises, functions and plain values', async () => {
        const scopeDef = scope({ productName: prop<string>() }).load({
            count: Promise.resolve(1),
            load: async () => 'loaded',
            plain: 'plain',
        });

        const resolved = await resolveThroughIsland(scopeDef, { productName: 'book' });

        expect(resolved).toMatchObject({
            productName: 'book',
            count: 1,
            load: 'loaded',
            plain: 'plain',
        });
    });

    test('resolves dependent levels, instantiating classes from prior levels', async () => {
        const scopeDef = scope({ productName: prop<string>() })
            .load({ id: async () => 7 })
            .load({
                label: async (params) => `${params.productName}#${params.id}`,
                store: TestStore,
            });

        const resolved = await resolveThroughIsland(scopeDef, { productName: 'book' });

        expect(resolved['label']).toBe('book#7');
        expect((resolved['store'] as TestStore).text).toBe('store:book');
    });

    test('resolves dependent levels in waterfall order', async () => {
        const order: string[] = [];

        const scopeDef = scope({ productName: prop<string>() })
            .load({
                name: async (params) => {
                    order.push('name');
                    return `name:${params.productName}`;
                },
            })
            .load({
                label: async (params) => {
                    order.push('label');
                    return `label:${params.name}`;
                },
            });

        const resolved = await resolveThroughIsland(scopeDef, { productName: 'book' });

        expect(resolved).toMatchObject({
            productName: 'book',
            name: 'name:book',
            label: 'label:name:book',
        });
        expect(order).toEqual(['name', 'label']);
    });
});
