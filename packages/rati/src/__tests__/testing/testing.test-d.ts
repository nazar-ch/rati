import { describe, test, expectTypeOf } from 'vite-plus/test';
import type { Source, SourceState } from '../../scope/source';
import { scope, input } from '../../scope/scope';
import { controllableSource, type ControllableSource } from '../../testing/controllableSource';
import { deferred } from '../../testing/deferred';
import { renderIsland } from '../../testing/renderIsland';

describe('deferred<T> infers T through resolve', () => {
    test('resolve takes T, promise yields T', () => {
        const gate = deferred<number>();
        expectTypeOf(gate.promise).toEqualTypeOf<Promise<number>>();
        expectTypeOf(gate.resolve).parameter(0).toEqualTypeOf<number>();
    });

    test('void makes resolve callable with no argument', () => {
        const gate = deferred<void>();
        // A `(value: void) => void` accepts a no-arg call.
        gate.resolve();
        expectTypeOf(gate.resolve).returns.toBeVoid();
    });
});

describe('controllableSource<T> infers T through its drivers', () => {
    test('is a Source<T> with T-typed mutators', () => {
        const source = controllableSource<{ id: string }>();
        expectTypeOf(source).toExtend<Source<{ id: string }>>();
        expectTypeOf(source).toExtend<ControllableSource<{ id: string }>>();
        expectTypeOf(source.setReady).parameter(0).toEqualTypeOf<{ id: string }>();
        expectTypeOf(source.getSnapshot()).toEqualTypeOf<SourceState<{ id: string }>>();
        expectTypeOf(source.attachCount).toBeNumber();
        expectTypeOf(source.attached).toBeBoolean();
    });

    test('T is inferred from `initial`', () => {
        const source = controllableSource({ initial: { id: 'a1' } });
        expectTypeOf(source.setReady).parameter(0).toEqualTypeOf<{ id: string }>();
    });

    test('`loads` and `ssr` are typed against T', () => {
        controllableSource<string>({ ssr: true, loads: 'hello' });
        controllableSource<{ n: number }>({
            ssr: { dehydrate: (value) => value.n, hydrate: () => {} },
        });
        // @ts-expect-error loads must match T
        controllableSource<string>({ loads: 123 });
    });

    test('`seed` is typed against T: dehydrate takes T, hydrate returns T', () => {
        controllableSource<{ n: number }>({
            seed: { dehydrate: (value) => value.n, hydrate: (data) => ({ n: data as number }) },
        });
        // @ts-expect-error hydrate must return T
        controllableSource<{ n: number }>({ seed: { hydrate: (data) => String(data) } });
    });
});

describe('renderIsland requires props exactly when the scope has required inputs', () => {
    const inputful = scope({ id: input<string>() }).load({ page: async ({ id }) => id });
    const inputless = scope().load({ page: async () => 'x' });
    const config = {
        scope: inputful,
        component: (_props: { id: string; page: string }) => null,
    };
    const bareConfig = {
        scope: inputless,
        component: (_props: { page: string }) => null,
    };

    test('an input-ful scope demands options with props — omitting either is an error', async () => {
        await renderIsland(config, { props: { id: 'a1' } });
        // @ts-expect-error options.props is required for a scope with required inputs
        await renderIsland(config, {});
        // @ts-expect-error options itself is required for a scope with required inputs
        await renderIsland(config);
    });

    test('an input-less scope needs neither options nor props', async () => {
        await renderIsland(bareConfig);
        await renderIsland(bareConfig, {});
    });

    test('rerender() mirrors the same rule — no silent input wipe', async () => {
        const handle = await renderIsland(config, { props: { id: 'a1' } });
        await handle.rerender({ id: 'a2' });
        // @ts-expect-error rerender must receive the inputs for an input-ful scope
        await handle.rerender();

        const bare = await renderIsland(bareConfig);
        await bare.rerender();
    });
});
