import { describe, test, expect, vi } from 'vite-plus/test';

import { autorun, observable, runInAction } from 'mobx';

import { query } from '../../data/query.js';
import { reconciled } from '../../data/reconciled.js';

interface Row {
    id: string;
    title: string;
}

/** An observable rows box — the "any observable rows" case, no fetch involved. */
function rowsBox(initial: readonly Row[]) {
    const box = observable.box<readonly Row[]>(initial, { deep: false });
    const setRows = (next: readonly Row[]) => {
        runInAction(() => box.set(next));
    };
    return { view: reconciled<Row>(() => box.get(), { key: (row) => row.id }), setRows };
}

describe('the derivation', () => {
    test('reconciles once at construction, before anything reads it', () => {
        const key = vi.fn((row: Row) => row.id);
        const view = reconciled<Row>(() => [{ id: 'a', title: 'Alpha' }], { key });
        expect(key).toHaveBeenCalled(); // eager, not on first read
        expect(view.items.map((item) => item.id)).toEqual(['a']);
    });

    test('re-reconciles when the getter output changes, keeping identities', () => {
        const { view, setRows } = rowsBox([
            { id: 'a', title: 'Alpha' },
            { id: 'b', title: 'Beta' },
        ]);
        const items = view.items;
        const [first, second] = items;

        setRows([
            { id: 'a', title: 'Alpha' },
            { id: 'b', title: 'Beta' },
        ]); // fresh objects, same content
        expect(view.items).toBe(items); // no churn
        expect(view.items[0]).toBe(first);

        setRows([
            { id: 'b', title: 'Beta v2' },
            { id: 'a', title: 'Alpha' },
        ]);
        expect(view.items[0]).toBe(second); // survived the move…
        expect(view.items[0]!.title).toBe('Beta v2'); // …updated in place
        expect(view.items[1]).toBe(first);
    });

    test('an observer of one item sees only its own change', () => {
        const { view, setRows } = rowsBox([
            { id: 'a', title: 'Alpha' },
            { id: 'b', title: 'Beta' },
        ]);
        const first = view.items[0]!;
        const seen: string[] = [];
        const dispose = autorun(() => seen.push(first.title));

        setRows([
            { id: 'a', title: 'Alpha v2' },
            { id: 'b', title: 'Beta' },
        ]);
        expect(seen).toEqual(['Alpha', 'Alpha v2']);
        dispose();
    });

    test('dispose() stops tracking; the last items stay readable', () => {
        const { view, setRows } = rowsBox([{ id: 'a', title: 'Alpha' }]);
        const items = view.items;

        view.dispose();
        setRows([{ id: 'b', title: 'Beta' }]);
        expect(view.items).toBe(items); // no re-reconcile
        expect(view.items.map((item) => item.id)).toEqual(['a']);
    });
});

describe('keyed ops (the same contract as inside a collection)', () => {
    test('patchItem marks the entry, so the next reconcile restores server truth', () => {
        const { view, setRows } = rowsBox([{ id: 'a', title: 'Alpha' }]);
        const item = view.items[0]!;

        view.patchItem('a', (current) => {
            current.title = 'Optimistic';
        });
        expect(item.title).toBe('Optimistic');

        // Byte-identical server rows — the patch must still be undone.
        setRows([{ id: 'a', title: 'Alpha' }]);
        expect(view.items[0]).toBe(item);
        expect(item.title).toBe('Alpha');
    });

    test('upsert / insert / remove write locally between reconciles', () => {
        const { view, setRows } = rowsBox([{ id: 'a', title: 'Alpha' }]);
        const item = view.items[0]!;

        view.upsert({ id: 'a', title: 'Pushed' });
        expect(view.items[0]).toBe(item);
        expect(item.title).toBe('Pushed');

        view.insert({ id: 'c', title: 'Gamma' });
        view.insert({ id: 'b', title: 'Beta' }, 1);
        expect(view.items.map((row) => row.id)).toEqual(['a', 'b', 'c']);

        view.remove('a');
        expect(view.items.map((row) => row.id)).toEqual(['b', 'c']);
        expect(view.getByKey('a')).toBeUndefined();

        // The rows getter is still the truth: the next reconcile wins.
        setRows([{ id: 'a', title: 'Alpha' }]);
        expect(view.items.map((row) => row.id)).toEqual(['a']);
    });
});

describe('the composite response (the case this exists for)', () => {
    interface Overview {
        usefulData: string;
        spaces: readonly Row[];
    }

    class OverviewStore {
        // Declaration order matters: the view's getter runs immediately.
        readonly overview;
        readonly spaces;
        constructor(fetchOverview: (signal: AbortSignal) => Promise<Overview>) {
            this.overview = query(fetchOverview);
            this.spaces = reconciled(() => this.overview.data?.spaces ?? [], {
                key: (row: Row) => row.id,
            });
        }
        get usefulData(): string | undefined {
            return this.overview.data?.usefulData;
        }
    }

    test('one fetch: the scalar half reads directly, the list half is identity-stable', async () => {
        let generation = 0;
        const fetchOverview = vi.fn(() =>
            Promise.resolve<Overview>({
                usefulData: `useful ${generation}`,
                spaces: [
                    { id: 'a', title: `Alpha ${generation}` },
                    { id: 'b', title: 'Beta' },
                ],
            }),
        );
        const store = new OverviewStore(fetchOverview);
        expect(store.spaces.items).toEqual([]); // nothing fetched yet

        await store.overview.prime();
        expect(fetchOverview).toHaveBeenCalledTimes(1);
        expect(store.usefulData).toBe('useful 0');
        const [alpha, beta] = store.spaces.items;
        expect(store.spaces.items.map((row) => row.id)).toEqual(['a', 'b']);

        generation = 1;
        await store.overview.refresh();
        expect(store.usefulData).toBe('useful 1');
        expect(store.spaces.items[0]).toBe(alpha); // identity survived the refresh
        expect(store.spaces.items[1]).toBe(beta);
        expect(alpha!.title).toBe('Alpha 1');
        expect(store.spaces.getByKey('b')).toBe(beta);
    });

    test('the query owns the phases; the view has none of its own', async () => {
        const store = new OverviewStore(() =>
            Promise.resolve<Overview>({ usefulData: 'x', spaces: [] }),
        );
        expect(store.overview.phase).toBe('idle');
        expect('phase' in store.spaces).toBe(false);
        expect('refresh' in store.spaces).toBe(false);
        expect('source' in store.spaces).toBe(false);

        await store.overview.prime();
        expect(store.overview.phase).toBe('ready');
    });
});
