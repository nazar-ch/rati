import { describe, test, expect, afterEach } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import { createView, viewParam, type CreateView } from '../common/view';
import { createIsland } from '../experimental/island';

afterEach(cleanup);

class TestStore {
    text: string;
    constructor(params: { productName: string }) {
        this.text = `store:${params.productName}`;
    }
}

// The standalone `resolveView` is gone — a view now resolves at render time inside
// the island engine. Render a throwaway island over `view` and capture the resolved
// props its component receives, so these exercise the same resolution matrix
// (params, raw promises, functions, classes, plain values, chained levels) through
// the engine that replaced it.
async function resolveThroughIsland(
    view: CreateView<any>,
    params: Record<string, unknown>
): Promise<Record<string, unknown>> {
    let received: Record<string, unknown> | undefined;
    const Island = createIsland({
        useEnv: () => ({}),
        view: () => view,
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

describe('view resolution through the island engine', () => {
    test('resolves params, raw promises, functions and plain values', async () => {
        const view = createView({
            productName: viewParam<string>(),
            count: Promise.resolve(1),
            load: async () => 'loaded',
            plain: 'plain',
        });

        const resolved = await resolveThroughIsland(view, { productName: 'book' });

        expect(resolved).toMatchObject({
            productName: 'book',
            count: 1,
            load: 'loaded',
            plain: 'plain',
        });
    });

    test('resolves views created with createView(prevView, definition), instantiating classes from prior levels', async () => {
        const base = createView({
            productName: viewParam<string>(),
            id: async () => 7,
        });

        const view = createView(base, {
            label: async (params) => `${params.productName}#${params.id}`,
            store: TestStore,
        });

        const resolved = await resolveThroughIsland(view, { productName: 'book' });

        expect(resolved['label']).toBe('book#7');
        expect((resolved['store'] as TestStore).text).toBe('store:book');
    });

    test('resolves chained views level by level (waterfall order)', async () => {
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

        const resolved = await resolveThroughIsland(view, { productName: 'book' });

        expect(resolved).toMatchObject({
            productName: 'book',
            name: 'name:book',
            label: 'label:name:book',
        });
        expect(order).toEqual(['name', 'label']);
    });
});
