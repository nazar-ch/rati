import { describe, test, expectTypeOf } from 'vite-plus/test';
import { scope, input } from '../../scope/scope';
import { useScopeControls } from '../../mandala/controls';
import type { IslandPhase } from '../../mandala/refresh';

// The same shape the runtime pins use: two inputs and two loads, so `refresh`'s key union
// has something to be wrong about.
const pageScope = scope({ id: input<string>() })
    .load({ name: async ({ id }) => `name:${id}` })
    .load({ tags: async () => ['a'] });

describe('useScopeControls — the status surface stays inferred off the scope', () => {
    test('phase is the three-member union, not string', () => {
        const controls = useScopeControls(pageScope);
        expectTypeOf(controls.phase).toEqualTypeOf<IslandPhase>();
        expectTypeOf(controls.phase).toEqualTypeOf<'loading' | 'ready' | 'error'>();
        expectTypeOf(controls.isStale).toEqualTypeOf<boolean>();
        expectTypeOf(controls.retry).toEqualTypeOf<() => void>();
    });

    test('the widened surface did not loosen refresh or pending', () => {
        const controls = useScopeControls(pageScope);
        // Still the scope's own load keys — inputs excluded, `any` nowhere.
        expectTypeOf(controls.pending).toEqualTypeOf<ReadonlySet<'name' | 'tags'>>();
        expectTypeOf(controls.refresh).parameter(0).toEqualTypeOf<'name' | 'tags' | undefined>();
    });

    test('a phase is never assignable from an arbitrary string', () => {
        const controls = useScopeControls(pageScope);
        // @ts-expect-error — 'stale' is not a phase; staleness is its own flag
        const bad: typeof controls.phase = 'stale';
        void bad;
    });
});
