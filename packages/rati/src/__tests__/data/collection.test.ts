import { describe, test, expect, vi } from 'vite-plus/test';
import { autorun } from 'mobx';
import { collection } from '../../data/collection';

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
        await c.query.load();
        const items = c.items;
        const [first] = items;

        await c.query.refresh(); // same content, fresh objects
        expect(c.items).toBe(items); // no-op recompute doesn't churn the array
        expect(c.items[0]).toBe(first);
    });

    test('a changed row updates the existing instance in place — nested reactivity', async () => {
        const { c, setRows } = rowsCollection([
            { id: 'a', title: 'Alpha' },
            { id: 'b', title: 'Beta' },
        ]);
        await c.query.load();
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
        await c.query.refresh();

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
        await c.query.load();
        const [first, second] = c.items;

        setRows([
            { id: 'b', title: 'Beta' },
            { id: 'a', title: 'Alpha' },
        ]);
        await c.query.refresh();
        expect(c.items[0]).toBe(second);
        expect(c.items[1]).toBe(first);
    });

    test('membership follows the server: rows disappear and appear', async () => {
        const { c, setRows } = rowsCollection([
            { id: 'a', title: 'Alpha' },
            { id: 'b', title: 'Beta' },
        ]);
        await c.query.load();
        const second = c.items[1]!;

        setRows([
            { id: 'b', title: 'Beta' },
            { id: 'c', title: 'Gamma' },
        ]);
        await c.query.refresh();
        expect(c.items.map((item) => item.id)).toEqual(['b', 'c']);
        expect(c.items[0]).toBe(second);
    });

    test('duplicate keys: the first occurrence wins', async () => {
        const { c } = rowsCollection([
            { id: 'a', title: 'First' },
            { id: 'a', title: 'Second' },
        ]);
        await c.query.load();
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
        await c.query.load();
        const item = c.items[0]!;
        expect(item).toBeInstanceOf(SpaceRow);
        item.expanded = true;

        rows = [{ id: 'a', title: 'Alpha v2' }];
        await c.query.refresh();
        expect(c.items[0]).toBe(item);
        expect(item.title).toBe('Alpha v2');
        expect(item.expanded).toBe(true);
    });
});

describe('optimistic edits and server truth', () => {
    test('patchItem edits in place; the next refresh restores server truth even for an unchanged row', async () => {
        const { c } = rowsCollection([{ id: 'a', title: 'Alpha' }]);
        await c.query.load();
        const item = c.items[0]!;

        c.patchItem('a', (current) => {
            current.title = 'Optimistic';
        });
        expect(item.title).toBe('Optimistic');

        // The mutation failed; onError: 'refresh' re-fetches — the server rows are
        // byte-identical to the last fetch, and the patch must still be undone.
        await c.query.refresh();
        expect(c.items[0]).toBe(item);
        expect(item.title).toBe('Alpha');
    });

    test('patchItem can return a replacement item', async () => {
        const { c } = rowsCollection([{ id: 'a', title: 'Alpha' }]);
        await c.query.load();
        const original = c.items[0]!;

        c.patchItem('a', (current) => ({ ...current, title: 'Replaced' }));
        expect(c.items[0]).not.toBe(original);
        expect(c.items[0]!.title).toBe('Replaced');
        expect(c.getByKey('a')).toBe(c.items[0]);
    });

    test('upsert reconciles one row: updates in place, appends unknown keys', async () => {
        const { c } = rowsCollection([{ id: 'a', title: 'Alpha' }]);
        await c.query.load();
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
        await c.query.load();

        c.insert({ id: 'b', title: 'Beta' }, 1);
        expect(c.items.map((row) => row.id)).toEqual(['a', 'b', 'c']);

        c.remove('a');
        expect(c.items.map((row) => row.id)).toEqual(['b', 'c']);
        expect(c.getByKey('a')).toBeUndefined();
    });
});

describe('source()', () => {
    test('pending until the first fetch, then ready with the collection itself', async () => {
        const { c } = rowsCollection([{ id: 'a', title: 'Alpha' }]);
        const source = c.source();
        expect(source.getSnapshot()).toEqual({ status: 'pending' });

        source.attach(); // triggers query.load()
        await c.query.load();
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
        await c.query.load();

        fail = true;
        await c.query.refresh();
        expect(c.query.phase).toBe('error');
        expect(c.items).toHaveLength(1); // stale rows still on screen
        expect(source.getSnapshot()).toEqual({ status: 'ready', value: c });
    });
});
