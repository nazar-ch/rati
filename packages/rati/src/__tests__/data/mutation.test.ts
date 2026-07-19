import { describe, test, expect, vi } from 'vite-plus/test';
import { collection } from '../../data/collection';
import { mutation } from '../../data/mutation';
import { deferred } from '../../testing';

describe('mutation state', () => {
    test('isPending spans the call; the result comes back; error stays null', async () => {
        const gate = deferred<string>();
        const rename = mutation((_id: string, _title: string) => gate.promise);

        expect(rename.isPending).toBe(false);
        const call = rename('a', 'Title');
        expect(rename.isPending).toBe(true);
        gate.resolve('ok');
        await expect(call).resolves.toBe('ok');
        expect(rename.isPending).toBe(false);
        expect(rename.error).toBeNull();
    });

    test('isPending is true while any of several independent calls is in flight', async () => {
        const gates = [deferred<void>(), deferred<void>()];
        let call = 0;
        const save = mutation(() => gates[call++]!.promise);

        const first = save();
        const second = save();
        gates[0]!.resolve();
        await first;
        expect(save.isPending).toBe(true); // the second is still out
        gates[1]!.resolve();
        await second;
        expect(save.isPending).toBe(false);
    });

    test('a failure normalizes onto mutation.error, rethrows, and clears on the next call', async () => {
        let fail = true;
        const save = mutation(() =>
            fail ? Promise.reject(new Error('denied')) : Promise.resolve('ok'),
        );

        await expect(save()).rejects.toThrow('denied');
        expect(save.error).toMatchObject({ code: 'failed', message: 'denied' });

        fail = false;
        const second = save();
        expect(save.error).toBeNull(); // cleared at call start, not on success
        await second;
    });
});

describe('optimistic choreography', () => {
    test('optimistic patches synchronously; success refreshes the declared dependents', async () => {
        let serverTitle = 'Alpha';
        const spaces = collection<{ id: string; title: string }>({
            fetch: () => Promise.resolve([{ id: 'a', title: serverTitle }]),
            key: (row) => row.id,
        });
        await spaces.query.load();

        const gate = deferred<void>();
        const rename = mutation(
            async (_id: string, title: string) => {
                await gate.promise;
                serverTitle = title;
            },
            {
                optimistic: (id, title) =>
                    spaces.patchItem(id, (item) => {
                        item.title = title;
                    }),
                refreshes: () => [spaces],
            },
        );

        const call = rename('a', 'Beta');
        // Expected truth, visible to every observer before the request settles:
        expect(spaces.getByKey('a')!.title).toBe('Beta');

        gate.resolve();
        await call;
        await spaces.query.refresh(); // join the fired refresh (dedupes in flight)
        expect(spaces.query.phase).toBe('ready');
        expect(spaces.getByKey('a')!.title).toBe('Beta'); // now actual truth
    });

    test("onError: 'refresh' (the default) recovers actual truth", async () => {
        const spaces = collection<{ id: string; title: string }>({
            fetch: () => Promise.resolve([{ id: 'a', title: 'Alpha' }]),
            key: (row) => row.id,
        });
        await spaces.query.load();

        const rename = mutation(
            (_id: string, _title: string) => Promise.reject(new Error('denied')),
            {
                optimistic: (id, title) =>
                    spaces.patchItem(id, (item) => {
                        item.title = title;
                    }),
                refreshes: () => [spaces],
            },
        );

        await expect(rename('a', 'Beta')).rejects.toThrow('denied');
        await spaces.query.refresh(); // join the recovery refresh
        expect(spaces.getByKey('a')!.title).toBe('Alpha'); // patch undone by truth
    });

    test('an onError callback replaces the refresh for local rollback', async () => {
        const refreshes = vi.fn(() => [] as { refresh(): Promise<void> }[]);
        const rollback = vi.fn();
        const save = mutation((_value: number) => Promise.reject(new Error('offline')), {
            refreshes,
            onError: rollback,
        });

        await expect(save(7)).rejects.toThrow('offline');
        expect(rollback).toHaveBeenCalledWith(7); // the original args, for the inverse patch
        expect(refreshes).not.toHaveBeenCalled();
    });
});
