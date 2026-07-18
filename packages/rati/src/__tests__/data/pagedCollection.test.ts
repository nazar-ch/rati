import { describe, test, expect, vi } from 'vite-plus/test';
import { pagedCollection } from '../../data/pagedCollection';

interface Row {
    id: string;
    title: string;
}

// A cursor API over a mutable dataset: cursor = the id of the last row served.
// Fresh row objects every call, as JSON parsing would produce.
function makeServer(initial: readonly Row[], pageSize: number) {
    let rows = initial;
    const fetchPage = vi.fn((cursor: string | null, _signal?: AbortSignal) => {
        const start = cursor === null ? 0 : rows.findIndex((row) => row.id === cursor) + 1;
        const page = rows.slice(start, start + pageSize).map((row) => ({ ...row }));
        const nextCursor = start + pageSize < rows.length ? page[page.length - 1]!.id : null;
        return Promise.resolve({ items: page, nextCursor });
    });
    return {
        fetchPage,
        setRows: (next: readonly Row[]) => {
            rows = next;
        },
    };
}

function pagedRows(initial: readonly Row[], pageSize: number) {
    const server = makeServer(initial, pageSize);
    const c = pagedCollection<Row>({
        fetchPage: server.fetchPage,
        key: (row) => row.id,
    });
    return { c, ...server };
}

const row = (id: string, title = id.toUpperCase()): Row => ({ id, title });

describe('loading pages', () => {
    test('loadMore walks the cursor chain; has-more is structural', async () => {
        const { c, fetchPage } = pagedRows([row('a'), row('b'), row('c')], 2);
        expect(c.hasMore).toBe(true); // the initial unloaded tail *is* page 0
        expect(c.items).toEqual([]);

        await c.loadMore();
        expect(fetchPage).toHaveBeenLastCalledWith(null, expect.any(AbortSignal));
        expect(c.items.map((item) => item.id)).toEqual(['a', 'b']);
        expect(c.hasMore).toBe(true); // a nextCursor materialized an unloaded tail
        expect(c.pages).toHaveLength(2);

        await c.loadMore();
        expect(fetchPage).toHaveBeenLastCalledWith('b', expect.any(AbortSignal));
        expect(c.items.map((item) => item.id)).toEqual(['a', 'b', 'c']);
        expect(c.hasMore).toBe(false); // no unloaded tail left
        await c.loadMore(); // fully loaded → no-op
        expect(fetchPage).toHaveBeenCalledTimes(2);
    });

    test("the tail page's phase is the spinner row; its failure is the inline retry row", async () => {
        let fail = false;
        const server = makeServer([row('a'), row('b'), row('c')], 2);
        const c = pagedCollection<Row>({
            fetchPage: (cursor, signal) =>
                fail ? Promise.reject(new Error('offline')) : server.fetchPage(cursor, signal),
            key: (r) => r.id,
        });
        await c.loadMore();

        fail = true;
        await c.loadMore();
        const tail = c.pages[1]!;
        expect(tail.phase).toBe('error'); // the rest of the list is untouched
        expect(c.items.map((item) => item.id)).toEqual(['a', 'b']);
        expect(c.hasMore).toBe(true); // still more — the tail just failed

        fail = false;
        await c.loadMore(); // load() from error → the retry
        expect(c.items.map((item) => item.id)).toEqual(['a', 'b', 'c']);
        expect(c.hasMore).toBe(false);
    });
});

describe('refresh', () => {
    test('re-anchors page by page; identities survive, changed rows update in place', async () => {
        const { c, setRows } = pagedRows([row('a'), row('b'), row('c'), row('d')], 2);
        await c.loadMore();
        await c.loadMore();
        const items = [...c.items];

        setRows([row('a'), row('b', 'B v2'), row('c'), row('d')]);
        await c.refresh();
        expect(c.items[1]).toBe(items[1]); // same instance…
        expect(c.items[1]!.title).toBe('B v2'); // …fresh fields
        expect(c.items.map((item) => item.id)).toEqual(['a', 'b', 'c', 'd']);
    });

    test('a row that crosses a page boundary keeps its instance', async () => {
        const { c, setRows } = pagedRows([row('a'), row('b'), row('c')], 2);
        await c.loadMore();
        await c.loadMore();
        const third = c.items[2]!; // 'c', currently on page 1

        setRows([row('a'), row('c')]); // 'b' deleted server-side
        await c.refresh();
        // Page 0 now serves [a, c] with no cursor — the stale page 1 truncates.
        expect(c.items.map((item) => item.id)).toEqual(['a', 'c']);
        expect(c.items[1]).toBe(third); // absorbed by the shared identity map
        expect(c.pages).toHaveLength(1);
        expect(c.hasMore).toBe(false);
    });
});

describe('reset and source', () => {
    test('reset returns to one unloaded page', async () => {
        const { c } = pagedRows([row('a'), row('b'), row('c')], 2);
        await c.loadMore();
        await c.loadMore();

        c.reset();
        expect(c.items).toEqual([]);
        expect(c.pages).toHaveLength(1);
        expect(c.pages[0]!.phase).toBe('idle');
        expect(c.hasMore).toBe(true);

        await c.loadMore(); // loads from scratch
        expect(c.items.map((item) => item.id)).toEqual(['a', 'b']);
    });

    test('source() is pending until the first page, then ready with the instance', async () => {
        const { c } = pagedRows([row('a'), row('b'), row('c')], 2);
        const source = c.source();
        expect(source.getSnapshot()).toEqual({ status: 'pending' });

        source.attach(); // ensures the first page only — depth is the app's call
        await c.loadMore();
        expect(source.getSnapshot()).toEqual({ status: 'ready', value: c });

        await c.loadMore(); // deeper pages never re-trip the island
        expect(source.getSnapshot()).toEqual({ status: 'ready', value: c });
    });
});
