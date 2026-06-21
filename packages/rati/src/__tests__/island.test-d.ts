import { describe, test, expectTypeOf } from 'vitest';
import { createView, viewParam, type ResolveView } from '../common/view';
import { type Source } from '../common/source';
import { type IslandParams, type IslandProps, type IslandViewOf } from '../experimental/island';

type Env = { prefix: string };

class TitleStore {
    constructor(_params: { id: string }) {}
    title = 'store';
}

// A representative env→view factory: two params, a function level that reads the
// env, and a class level — i.e. the shape passed to `createIsland({ view })`.
const pageView = (env: Env) =>
    createView
        .chain({ id: viewParam<string>(), revision: viewParam<number>() })
        .chain({ name: async ({ id }) => `${env.prefix}:${id}` })
        .chain({ store: TitleStore });

describe('island type helpers', () => {
    test('IslandProps resolves the component props straight off the factory', () => {
        expectTypeOf<IslandProps<typeof pageView>>().toEqualTypeOf<{
            id: string;
            revision: number;
            name: string;
            store: TitleStore;
        }>();
    });

    test('IslandParams collects only the viewParams the island accepts as props', () => {
        expectTypeOf<IslandParams<typeof pageView>>().toEqualTypeOf<{
            id: string;
            revision: number;
        }>();
    });

    test('IslandProps matches deriving from the view by hand (no ReturnType step)', () => {
        type ByHand = IslandViewOf<typeof pageView>;
        expectTypeOf<IslandProps<typeof pageView>>().toEqualTypeOf<ResolveView<ByHand>>();
    });

    test('IslandProps unwraps a Source<T> prop to its ready value T', () => {
        const liveView = (_env: Env) =>
            createView
                .chain({ id: viewParam<string>() })
                .chain({ live: (): Source<number> => undefined as unknown as Source<number> });

        expectTypeOf<IslandProps<typeof liveView>>().toEqualTypeOf<{
            id: string;
            live: number;
        }>();
    });
});
