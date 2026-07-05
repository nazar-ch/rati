import { describe, test, expectTypeOf } from 'vite-plus/test';
import { scope, input, hook, type ScopeInputs, type ScopeProps } from '../../scope/scope';
import { type Source } from '../../scope/source';
import { useOptionalScope, useScope } from '../../mandala/channel';

class TitleStore {
    constructor(_params: { id: string }) {}
    title = 'store';
}

// A representative scope: two params, a function level, and a class level.
const pageScope = scope({ id: input<string>(), revision: input<number>() })
    .load({ name: async ({ id }) => `name:${id}` })
    .load({ store: TitleStore });

describe('scope type helpers', () => {
    test('ScopeProps resolves the component props off the scope', () => {
        expectTypeOf<ScopeProps<typeof pageScope>>().toEqualTypeOf<{
            id: string;
            revision: number;
            name: string;
            store: TitleStore;
        }>();
    });

    test('ScopeInputs collects only the input() inputs', () => {
        expectTypeOf<ScopeInputs<typeof pageScope>>().toEqualTypeOf<{
            id: string;
            revision: number;
        }>();
    });

    test('ScopeProps unwraps a Source<T> input to its ready value T', () => {
        const liveScope = scope({ id: input<string>() }).load({
            live: (): Source<number> => undefined as unknown as Source<number>,
        });

        expectTypeOf<ScopeProps<typeof liveScope>>().toEqualTypeOf<{
            id: string;
            live: number;
        }>();
    });

    test('a hook() load resolves to its return type (Source unwrapped); not an input', () => {
        const hookScope = scope({ id: input<string>() })
            .load({ stores: hook(() => ({ prefix: 'p' })) })
            .load({ live: hook((): Source<number> => undefined as unknown as Source<number>) })
            .load({ greeting: ({ stores, id }) => `${stores.prefix}:${id}` });

        expectTypeOf<ScopeProps<typeof hookScope>>().toEqualTypeOf<{
            id: string;
            stores: { prefix: string };
            live: number;
            greeting: string;
        }>();

        // hook loads aren't inputs.
        expectTypeOf<ScopeInputs<typeof hookScope>>().toEqualTypeOf<{ id: string }>();
    });

    test('.provide() factory receives the fully resolved scope, typed', () => {
        scope({ id: input<string>(), revision: input<number>() })
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

    test('useScope returns the .provide() value type off the scope; the value is not a input', () => {
        const ctxScope = scope({ id: input<string>() })
            .load({ name: async ({ id }) => `name:${id}` })
            .provide(({ name }) => ({ heading: name.toUpperCase() }));

        // The scope is the key (a data module, importable cycle-free) — no island
        // component reference; the type comes straight off the scope.
        expectTypeOf(useScope(ctxScope)).toEqualTypeOf<{ heading: string }>();

        // The optional form widens the same value type with `undefined`.
        expectTypeOf(useOptionalScope(ctxScope)).toEqualTypeOf<{ heading: string } | undefined>();

        // The provided value stays out of the component's resolved props.
        expectTypeOf<ScopeProps<typeof ctxScope>>().toEqualTypeOf<{ id: string; name: string }>();
    });

    test('reading a scope without .provide() returns the resolved props', () => {
        expectTypeOf(useScope(pageScope)).toEqualTypeOf<{
            id: string;
            revision: number;
            name: string;
            store: TitleStore;
        }>();
    });
});
