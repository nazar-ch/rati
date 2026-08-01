import { describe, test, expect, vi } from 'vite-plus/test';
import { autorun, observable, runInAction } from 'mobx';
import { collection } from '../../data/collection';
import { controllableProducer } from '../../testing/data';

interface Row {
    id: string;
    title: string;
}

// Every fetch returns *fresh* row objects (as JSON parsing would), so identity
// stability below is the reconciler's doing, never accidental reference reuse.
function rowsCollection(initial: readonly Row[]) {
    let rows = initial;
    const fetch = vi.fn(() => Promise.resolve(rows.map((row) => ({ ...row }))));
    const setRows = (next: readonly Row[]) => {
        rows = next;
    };
    return { c: collection<Row>({ fetch, key: (row) => row.id }), setRows, fetch };
}

describe('reconciliation', () => {
    test('unchanged rows keep their item instance and the array reference', async () => {
        const { c } = rowsCollection([
            { id: 'a', title: 'Alpha' },
            { id: 'b', title: 'Beta' },
        ]);
        await c.prime();
        const items = c.items;
        const [first] = items;

        await c.refresh(); // same content, fresh objects
        expect(c.items).toBe(items); // no-op recompute doesn't churn the array
        expect(c.items[0]).toBe(first);
    });

    test('a changed row updates the existing instance in place — nested reactivity', async () => {
        const { c, setRows } = rowsCollection([
            { id: 'a', title: 'Alpha' },
            { id: 'b', title: 'Beta' },
        ]);
        await c.prime();
        const items = c.items;
        const first = c.items[0]!;

        const seenTitles: string[] = [];
        const dispose = autorun(() => {
            seenTitles.push(first.title);
        });

        setRows([
            { id: 'a', title: 'Alpha v2' },
            { id: 'b', title: 'Beta' },
        ]);
        await c.refresh();

        expect(c.items[0]).toBe(first); // same instance…
        expect(first.title).toBe('Alpha v2'); // …new fields
        expect(seenTitles).toEqual(['Alpha', 'Alpha v2']); // observers of the item saw it
        expect(c.items).toBe(items); // identity/order/membership unmoved → array kept
        dispose();
    });

    test('order comes from the fresh result; instances survive the move', async () => {
        const { c, setRows } = rowsCollection([
            { id: 'a', title: 'Alpha' },
            { id: 'b', title: 'Beta' },
        ]);
        await c.prime();
        const [first, second] = c.items;

        setRows([
            { id: 'b', title: 'Beta' },
            { id: 'a', title: 'Alpha' },
        ]);
        await c.refresh();
        expect(c.items[0]).toBe(second);
        expect(c.items[1]).toBe(first);
    });

    test('membership follows the server: rows disappear and appear', async () => {
        const { c, setRows } = rowsCollection([
            { id: 'a', title: 'Alpha' },
            { id: 'b', title: 'Beta' },
        ]);
        await c.prime();
        const second = c.items[1]!;

        setRows([
            { id: 'b', title: 'Beta' },
            { id: 'c', title: 'Gamma' },
        ]);
        await c.refresh();
        expect(c.items.map((item) => item.id)).toEqual(['b', 'c']);
        expect(c.items[0]).toBe(second);
    });

    test('duplicate keys: the first occurrence wins', async () => {
        const { c } = rowsCollection([
            { id: 'a', title: 'First' },
            { id: 'a', title: 'Second' },
        ]);
        await c.prime();
        expect(c.items).toHaveLength(1);
        expect(c.items[0]!.title).toBe('First');
    });

    test('into wraps rows in app instances and preserves them across refreshes', async () => {
        class SpaceRow {
            title: string;
            expanded = false; // per-item UI state that must survive refresh
            constructor(
                public readonly id: string,
                raw: Row,
            ) {
                this.title = raw.title;
            }
            update(raw: Row): this {
                this.title = raw.title;
                return this;
            }
        }
        let rows: readonly Row[] = [{ id: 'a', title: 'Alpha' }];
        const c = collection<Row, SpaceRow>({
            fetch: () => Promise.resolve(rows.map((row) => ({ ...row }))),
            key: (row) => row.id,
            into: (raw, prev) => (prev ? prev.update(raw) : new SpaceRow(raw.id, raw)),
        });
        await c.prime();
        const item = c.items[0]!;
        expect(item).toBeInstanceOf(SpaceRow);
        item.expanded = true;

        rows = [{ id: 'a', title: 'Alpha v2' }];
        await c.refresh();
        expect(c.items[0]).toBe(item);
        expect(item.title).toBe('Alpha v2');
        expect(item.expanded).toBe(true);
    });
});

describe('optimistic edits and server truth', () => {
    test('patchItem edits in place; the next refresh restores server truth even for an unchanged row', async () => {
        const { c } = rowsCollection([{ id: 'a', title: 'Alpha' }]);
        await c.prime();
        const item = c.items[0]!;

        c.patchItem('a', (current) => {
            current.title = 'Optimistic';
        });
        expect(item.title).toBe('Optimistic');

        // The mutation failed; onError: 'refresh' re-fetches — the server rows are
        // byte-identical to the last fetch, and the patch must still be undone.
        await c.refresh();
        expect(c.items[0]).toBe(item);
        expect(item.title).toBe('Alpha');
    });

    test('patchItem can return a replacement item', async () => {
        const { c } = rowsCollection([{ id: 'a', title: 'Alpha' }]);
        await c.prime();
        const original = c.items[0]!;

        c.patchItem('a', (current) => ({ ...current, title: 'Replaced' }));
        expect(c.items[0]).not.toBe(original);
        expect(c.items[0]!.title).toBe('Replaced');
        expect(c.getByKey('a')).toBe(c.items[0]);
    });

    test('upsert reconciles one row: updates in place, appends unknown keys', async () => {
        const { c } = rowsCollection([{ id: 'a', title: 'Alpha' }]);
        await c.prime();
        const item = c.items[0]!;

        c.upsert({ id: 'a', title: 'Pushed' }); // server-push update
        expect(c.items[0]).toBe(item);
        expect(item.title).toBe('Pushed');

        c.upsert({ id: 'b', title: 'New' });
        expect(c.items.map((row) => row.id)).toEqual(['a', 'b']);
    });

    test('insert places locally, remove drops locally', async () => {
        const { c } = rowsCollection([
            { id: 'a', title: 'Alpha' },
            { id: 'c', title: 'Gamma' },
        ]);
        await c.prime();

        c.insert({ id: 'b', title: 'Beta' }, 1);
        expect(c.items.map((row) => row.id)).toEqual(['a', 'b', 'c']);

        c.remove('a');
        expect(c.items.map((row) => row.id)).toEqual(['b', 'c']);
        expect(c.getByKey('a')).toBeUndefined();
    });
});

describe('the flat facade', () => {
    // DATA-13: fetch state and item state sit side by side; there is no `.query`
    // to reach through, and no raw pre-reconcile array either.
    test('phase / error / isPending / prime / refresh reach the backing query', async () => {
        const server = controllableProducer<readonly Row[]>();
        const c = collection<Row>({ fetch: server.producer, key: (row) => row.id });
        expect(c.phase).toBe('idle');
        expect(c.error).toBeNull();
        expect(c.isPending).toBe(false);
        expect('query' in c).toBe(false);

        const priming = c.prime();
        expect(c.phase).toBe('loading');
        expect(c.isPending).toBe(true);
        server.resolve([{ id: 'a', title: 'Alpha' }]);
        await priming;
        expect(c.phase).toBe('ready');
        expect(c.items).toHaveLength(1);

        const refreshing = c.refresh();
        expect(c.phase).toBe('refreshing'); // items stay visible
        expect(c.items).toHaveLength(1);
        server.reject(new Error('offline'));
        await refreshing;
        expect(c.phase).toBe('error');
        expect(c.error?.message).toBe('offline');
        expect(c.items).toHaveLength(1); // …still visible, beside the error
    });

    test('prime() is the ensure: a second call on a ready collection does not re-fetch', async () => {
        const { c, fetch } = rowsCollection([{ id: 'a', title: 'Alpha' }]);
        await c.prime();
        await c.prime();
        expect(fetch).toHaveBeenCalledTimes(1);

        await c.refresh(); // the gesture *is* the re-fetch
        expect(fetch).toHaveBeenCalledTimes(2);
    });
});

describe('source()', () => {
    test('pending until the first fetch, then ready with the collection itself', async () => {
        const { c } = rowsCollection([{ id: 'a', title: 'Alpha' }]);
        const source = c.source();
        expect(source.getSnapshot()).toEqual({ status: 'pending' });

        source.attach(); // triggers query.prime()
        await c.prime();
        expect(source.getSnapshot()).toEqual({ status: 'ready', value: c });
    });

    test('a refresh failure stays on the instance — the island never re-trips', async () => {
        let fail = false;
        const c = collection<Row>({
            fetch: () =>
                fail
                    ? Promise.reject(new Error('offline'))
                    : Promise.resolve([{ id: 'a', title: 'Alpha' }]),
            key: (row) => row.id,
        });
        const source = c.source();
        await c.prime();

        fail = true;
        await c.refresh();
        expect(c.phase).toBe('error');
        expect(c.items).toHaveLength(1); // stale rows still on screen
        expect(source.getSnapshot()).toEqual({ status: 'ready', value: c });
    });
});

describe('reactive (pass-through to the query)', () => {
    test('a keystroke filter re-fetches through the reconciler, keeping identities', async () => {
        const store = observable({ term: '' });
        const dataset = [
            { id: 'a', title: 'Alpha' },
            { id: 'b', title: 'Beta' },
            { id: 'c', title: 'Alfred' },
        ];
        const c = collection<Row>({
            fetch: () => {
                const term = store.term; // read synchronously → tracked
                return Promise.resolve(
                    dataset.filter((row) => row.title.startsWith(term)).map((row) => ({ ...row })),
                );
            },
            key: (row) => row.id,
            reactive: true,
        });

        await c.prime(); // term '' → all three
        expect(c.items.map((row) => row.id)).toEqual(['a', 'b', 'c']);
        const alpha = c.items[0]!;

        runInAction(() => {
            store.term = 'Al';
        });
        await c.prime(); // reactive re-fetch, filtered
        expect(c.items.map((row) => row.id)).toEqual(['a', 'c']);
        expect(c.items[0]).toBe(alpha); // surviving row keeps its instance
    });
});

describe('reset() and the item map', () => {
    test('reset() empties the rows the view tracks, so the items go with them', async () => {
        const { c } = rowsCollection([
            { id: 'a', title: 'Alpha' },
            { id: 'b', title: 'Beta' },
        ]);
        await c.prime();
        expect(c.items).toHaveLength(2);

        c.reset();
        expect(c.items).toEqual([]); // the view re-reconciled against no rows
        expect(c.getByKey('a')).toBeUndefined();
        expect(c.phase).toBe('idle');
    });
});

describe('local writes racing an in-flight refresh (last-write-wins)', () => {
    // The recorded stance (data-package README §Open questions): "last-write-wins —
    // an upsert during a refresh is reconciled away if the refresh's rows disagree."
    // The settle's `reconcile()` is the last write; these pin it in both directions.
    test('a local upsert the server never had is reconciled away on settle', async () => {
        const server = controllableProducer<readonly Row[]>();
        const c = collection<Row>({ fetch: server.producer, key: (row) => row.id });

        const first = c.prime();
        server.resolve([{ id: 'a', title: 'Alpha' }]);
        await first;

        const refreshing = c.refresh(); // fetch in flight
        c.upsert({ id: 'z', title: 'Local' }); // a server-push-style add, mid-refresh
        expect(c.items.map((row) => row.id)).toEqual(['a', 'z']); // visible immediately…

        server.resolve([{ id: 'a', title: 'Alpha' }]); // …but the server never had 'z'
        await refreshing;
        expect(c.items.map((row) => row.id)).toEqual(['a']); // the reconcile dropped it
    });

    test('a local remove of a row the server still has is restored on settle', async () => {
        const server = controllableProducer<readonly Row[]>();
        const c = collection<Row>({ fetch: server.producer, key: (row) => row.id });

        const first = c.prime();
        server.resolve([
            { id: 'a', title: 'Alpha' },
            { id: 'b', title: 'Beta' },
        ]);
        await first;

        const refreshing = c.refresh();
        c.remove('a'); // drop 'a' locally while the fetch is out
        expect(c.items.map((row) => row.id)).toEqual(['b']);

        server.resolve([
            { id: 'a', title: 'Alpha' },
            { id: 'b', title: 'Beta' },
        ]); // the server still lists 'a'
        await refreshing;
        expect(c.items.map((row) => row.id)).toEqual(['a', 'b']); // reconcile restored it
    });
});
