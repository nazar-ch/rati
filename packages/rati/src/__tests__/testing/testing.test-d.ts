import { describe, test, expectTypeOf } from 'vite-plus/test';
import type { Source, SourceState } from '../../scope/source';
import { controllableSource, type ControllableSource } from '../../testing/controllableSource';
import { deferred } from '../../testing/deferred';

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
});
