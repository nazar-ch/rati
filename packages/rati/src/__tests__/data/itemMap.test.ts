import { describe, test, expect, vi } from 'vite-plus/test';
import { itemMap } from '../../data/itemMap';

// The identity map under `collection`/`pagedCollection` (package-internal). The
// collection suites drive it through the reconcile-on-refresh path; these pin the
// direct-mutation branches (`insert`/`upsert`/`clear`) and the `equals` seam that no
// collection test reaches — DATA-09's item-map coverage gaps.

interface Row {
    id: string;
    title: string;
}

describe('insert', () => {
    test('an existing key upserts in place, keeping its position (not a move to the end)', () => {
        const map = itemMap<Row, Row>({ key: (row) => row.id });
        map.insert({ id: 'a', title: 'Alpha' });
        map.insert({ id: 'b', title: 'Beta' });
        const [a, b] = map.items;

        // Same key again → delegates to upsert: updates fields in place, no duplicate,
        // no reordering to the tail.
        map.insert({ id: 'a', title: 'Alpha v2' });
        expect(map.items.map((row) => row.id)).toEqual(['a', 'b']);
        expect(map.items[0]).toBe(a); // same instance, updated in place
        expect(map.items[0]!.title).toBe('Alpha v2');
        expect(map.items[1]).toBe(b);
    });
});

describe('upsert', () => {
    test('short-circuits on a genuinely unchanged raw (default equals): no re-wrap, array kept', () => {
        // `into` lets us observe whether the update path ran: it is called once to
        // create, and again only when `upsert` decides the row actually changed.
        const into = vi.fn((raw: Row, prev: Row | undefined): Row => {
            if (prev) {
                prev.title = raw.title;
                return prev;
            }
            return { id: raw.id, title: raw.title };
        });
        const map = itemMap<Row, Row>({ key: (row) => row.id, into });

        map.upsert({ id: 'a', title: 'Alpha' });
        const item = map.items[0]!;
        const arr = map.items;
        expect(into).toHaveBeenCalledTimes(1); // the create
        into.mockClear();

        map.upsert({ id: 'a', title: 'Alpha' }); // shallow-equal raw → short-circuit
        expect(into).not.toHaveBeenCalled(); // the update path was skipped entirely
        expect(map.items[0]).toBe(item); // same instance
        expect(map.items).toBe(arr); // same array reference (no replace)

        map.upsert({ id: 'a', title: 'Changed' }); // not equal → the update path runs
        expect(into).toHaveBeenCalledTimes(1);
        expect(map.items[0]).toBe(item); // `into` returned prev → identity preserved
        expect(item.title).toBe('Changed');
    });

    test('a custom equals decides "unchanged": a differing non-key field is treated as equal and skipped', () => {
        // Coarser than the default `comparer.shallow`: equality by id only, so the
        // title is ignored for change detection.
        const map = itemMap<Row, Row>({
            key: (row) => row.id,
            equals: (a, b) => a.id === b.id,
        });
        map.upsert({ id: 'a', title: 'Alpha' });
        const item = map.items[0]!;
        const arr = map.items;

        map.upsert({ id: 'a', title: 'Ignored' }); // equal by the id-only equals
        expect(map.items[0]).toBe(item); // instance untouched…
        expect(map.items).toBe(arr); // …array reference kept…
        expect(item.title).toBe('Alpha'); // …update skipped, so the old field survives
    });
});

describe('clear', () => {
    test('empties the items array and the key index', () => {
        const map = itemMap<Row, Row>({ key: (row) => row.id });
        map.upsert({ id: 'a', title: 'Alpha' });
        map.upsert({ id: 'b', title: 'Beta' });
        expect(map.items).toHaveLength(2);

        map.clear();
        expect(map.items).toEqual([]);
        expect(map.getByKey('a')).toBeUndefined();
        expect(map.getByKey('b')).toBeUndefined();
    });
});
