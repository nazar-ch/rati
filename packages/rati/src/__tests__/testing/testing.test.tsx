import { describe, test, expect } from 'vite-plus/test';
import { isSource, type SourceState } from '../../scope/source';
import { controllableSource } from '../../testing/controllableSource';
import { deferred } from '../../testing/deferred';
import { flush } from '../../testing/flush';

describe('deferred', () => {
    test('resolves by hand', async () => {
        const gate = deferred<number>();
        let settled: number | undefined;
        void gate.promise.then((value) => (settled = value));
        gate.resolve(42);
        await gate.promise;
        expect(settled).toBe(42);
    });

    test('rejects by hand', async () => {
        const gate = deferred<number>();
        gate.reject(new Error('boom'));
        await expect(gate.promise).rejects.toThrow('boom');
    });

    test('T = void makes resolve() no-arg', async () => {
        const gate = deferred<void>();
        gate.resolve();
        await expect(gate.promise).resolves.toBeUndefined();
    });
});

describe('flush', () => {
    test('drains a queued microtask', async () => {
        let ran = false;
        queueMicrotask(() => (ran = true));
        await flush();
        expect(ran).toBe(true);
    });
});

describe('controllableSource — state machine', () => {
    const snapshots = <T,>(source: {
        subscribe: (fn: () => void) => () => void;
        getSnapshot: () => SourceState<T>;
    }) => {
        const seen: SourceState<T>[] = [];
        source.subscribe(() => seen.push(source.getSnapshot()));
        return seen;
    };

    test('starts pending and is a real Source', () => {
        const source = controllableSource<string>();
        expect(isSource(source)).toBe(true);
        expect(source.getSnapshot()).toEqual({ status: 'pending' });
    });

    test('walks pending → ready → pending → ready', () => {
        const source = controllableSource<string>();
        const seen = snapshots(source);
        source.setReady('a');
        source.setPending();
        source.setReady('b');
        expect(seen).toEqual([
            { status: 'ready', value: 'a' },
            { status: 'pending' },
            { status: 'ready', value: 'b' },
        ]);
        expect(source.getSnapshot()).toEqual({ status: 'ready', value: 'b' });
    });

    test('each setReady is a fresh snapshot identity (uSES sees a change)', () => {
        const source = controllableSource<string>();
        source.setReady('x');
        const first = source.getSnapshot();
        source.setReady('x');
        expect(source.getSnapshot()).not.toBe(first);
    });

    test('setError takes a string as the code, or a full SourceError', () => {
        const source = controllableSource<string>();
        source.setError('not-available');
        expect(source.getSnapshot()).toEqual({ status: 'error', error: { code: 'not-available' } });
        source.setError({ code: 'failed', message: 'boom' });
        expect(source.getSnapshot()).toEqual({
            status: 'error',
            error: { code: 'failed', message: 'boom' },
        });
    });

    test('initial starts ready with a stable identity', () => {
        const value = { id: 'a1' };
        const source = controllableSource({ initial: value });
        const snap = source.getSnapshot();
        expect(snap).toEqual({ status: 'ready', value });
        if (snap.status === 'ready') expect(snap.value).toBe(value);
    });

    test('emit re-emits the last ready value with the same value identity', () => {
        const source = controllableSource<{ n: number }>();
        source.setReady({ n: 1 });
        const readyValue = (source.getSnapshot() as { status: 'ready'; value: { n: number } })
            .value;
        const seen = snapshots(source);
        source.emit();
        const snap = source.getSnapshot();
        // A new state object (uSES re-renders) wrapping the *same* value (equals-gate holds).
        expect(seen).toHaveLength(1);
        if (snap.status === 'ready') expect(snap.value).toBe(readyValue);
    });

    test('emit throws before the first setReady', () => {
        const source = controllableSource<string>();
        expect(() => source.emit()).toThrow(/no ready value/);
    });
});

describe('controllableSource — attach/detach ledger', () => {
    test('counts attaches and detaches; attached reflects the live state', () => {
        const source = controllableSource<string>();
        expect(source.attached).toBe(false);
        const detach = source.attach();
        expect(source.attachCount).toBe(1);
        expect(source.attached).toBe(true);
        detach();
        expect(source.detachCount).toBe(1);
        expect(source.attached).toBe(false);
    });

    test('peakAttached catches a double-attach of a live entry', () => {
        const source = controllableSource<string>();
        const a = source.attach();
        const b = source.attach(); // still live — a double attach
        expect(source.peakAttached).toBe(2);
        a();
        b();
        // The peak is a high-water mark: it does not drop when the source detaches.
        expect(source.peakAttached).toBe(2);
        expect(source.attached).toBe(false);
    });

    test('onAttach / onDetach run at the ledger edges for ordering assertions', () => {
        const log: string[] = [];
        const source = controllableSource<string>({
            onAttach: () => log.push('attach'),
            onDetach: () => log.push('detach'),
        });
        const detach = source.attach();
        source.setReady('v');
        log.push('ready');
        detach();
        expect(log).toEqual(['attach', 'ready', 'detach']);
    });
});

describe('controllableSource — the loader shape (ssr: true + loads)', () => {
    test('attach settles ready on a microtask; carries the ssr marker', async () => {
        const source = controllableSource<string>({ ssr: true, loads: 'hello' });
        expect(source.ssr).toBe(true);
        const detach = source.attach();
        expect(source.getSnapshot()).toEqual({ status: 'pending' });
        await Promise.resolve();
        expect(source.getSnapshot()).toEqual({ status: 'ready', value: 'hello' });
        detach();
    });

    test('a seeded (initial-ready) source does not re-load on attach', async () => {
        const source = controllableSource<string>({ ssr: true, loads: 'hello', initial: 'seed' });
        source.attach();
        await Promise.resolve();
        expect(source.getSnapshot()).toEqual({ status: 'ready', value: 'seed' });
    });

    test('a seedable ssr marker can reference the source (no real cycle)', () => {
        const source = controllableSource<{ n: number }>({
            ssr: {
                dehydrate: (value) => value.n,
                hydrate: (data) => source.setReady({ n: data as number }),
            },
        });
        expect(typeof source.ssr).toBe('object');
        (source.ssr as { hydrate: (d: unknown) => void }).hydrate(7);
        expect(source.getSnapshot()).toEqual({ status: 'ready', value: { n: 7 } });
    });
});
