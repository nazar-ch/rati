import { describe, test, expectTypeOf } from 'vitest';
import { scope, prop, type ScopeOf, type ScopeParams, type ScopeProps } from '../common/scope';
import { type Source } from '../common/source';
import { island, useOptionalScope, useScope } from '../experimental/island';

type Env = { prefix: string };

class TitleStore {
    constructor(_params: { id: string }) {}
    title = 'store';
}

// A representative env→scope factory: two params, a load level that reads the env,
// and a class level — i.e. the shape passed to `island({ scope })`.
const pageScope = (env: Env) =>
    scope({ id: prop<string>(), revision: prop<number>() })
        .load({ name: async ({ id }) => `${env.prefix}:${id}` })
        .load({ store: TitleStore });

describe('scope type helpers', () => {
    test('ScopeProps resolves the component props straight off the factory', () => {
        expectTypeOf<ScopeProps<typeof pageScope>>().toEqualTypeOf<{
            id: string;
            revision: number;
            name: string;
            store: TitleStore;
        }>();
    });

    test('ScopeParams collects only the props the island accepts as inputs', () => {
        expectTypeOf<ScopeParams<typeof pageScope>>().toEqualTypeOf<{
            id: string;
            revision: number;
        }>();
    });

    test('ScopeProps matches deriving from the scope by hand (factory unwrapped)', () => {
        type ByHand = ScopeOf<typeof pageScope>;
        expectTypeOf<ScopeProps<typeof pageScope>>().toEqualTypeOf<ScopeProps<ByHand>>();
    });

    test('ScopeProps unwraps a Source<T> prop to its ready value T', () => {
        const liveScope = (_env: Env) =>
            scope({ id: prop<string>() }).load({
                live: (): Source<number> => undefined as unknown as Source<number>,
            });

        expectTypeOf<ScopeProps<typeof liveScope>>().toEqualTypeOf<{
            id: string;
            live: number;
        }>();
    });

    test('.provide() factory receives the fully resolved scope, typed', () => {
        (_env: Env) =>
            scope({ id: prop<string>(), revision: prop<number>() })
                .load({ name: async ({ id }) => `${id}` })
                .provide((resolved) => {
                    expectTypeOf(resolved).toEqualTypeOf<{
                        id: string;
                        revision: number;
                        name: string;
                    }>();
                    return { heading: resolved.name };
                });
    });

    test('useScope returns the .provide() value type; the value is not a prop', () => {
        const ctxScope = (env: Env) =>
            scope({ id: prop<string>() })
                .load({ name: async ({ id }) => `${env.prefix}:${id}` })
                .provide(({ name }) => ({ heading: name.toUpperCase() }));

        const Island = island({
            useEnv: () => ({ prefix: 'p' }) as Env,
            scope: ctxScope,
            component: () => null,
            loading: () => null,
        });

        expectTypeOf(useScope(Island)).toEqualTypeOf<{ heading: string }>();

        // The optional form widens the same value type with `undefined`.
        expectTypeOf(useOptionalScope(Island)).toEqualTypeOf<{ heading: string } | undefined>();

        // The provided value stays out of the component's resolved props.
        expectTypeOf<ScopeProps<typeof ctxScope>>().toEqualTypeOf<{ id: string; name: string }>();
    });
});
