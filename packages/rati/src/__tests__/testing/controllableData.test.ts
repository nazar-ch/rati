import { afterEach, describe, expect, test, vi } from 'vite-plus/test';

import { observable, runInAction } from 'mobx';

import { collection } from '../../data/collection';
import { pagedCollection, type PageResult } from '../../data/pagedCollection';
import { query, type Query } from '../../data/query';
import { controllableProducer, controllableQuery } from '../../testing/data';

interface Row {
    id: string;
    title: string;
}

afterEach(() => {
    vi.useRealTimers();
});

describe('controllableProducer', () => {
    test('records every call and settles them oldest-first', async () => {
        const server = controllableProducer<number>();
        const q = query(server.producer);

        expect(server.callCount).toBe(0);
        const first = q.prime();
        expect(server.callCount).toBe(1);
        expect(server.pendingCall.index).toBe(0);

        server.resolve(1);
        await first;
        expect(q.data).toBe(1);
        expect(server.lastCall.settled).toBe(true);

        const second = q.refresh();
        expect(server.callCount).toBe(2);
        server.resolve(2); // the oldest un-settled call — call 1
        await second;
        expect(q.data).toBe(2);
    });

    test('a call is addressable, so an out-of-order settle is expressible', async () => {
        const server = controllableProducer<string>();
        const q = query(server.producer);

        const first = q.prime();
        q.reset(); // supersedes call 0
        const second = q.prime();

        // Settle the *newer* call first; the superseded one lands into the void.
        server.calls[1]!.resolve('new');
        server.calls[0]!.resolve('old');
        await Promise.all([first, second]);
        expect(q.data).toBe('new');
    });

    test('exposes each call’s signal, so abort-on-supersede is a one-liner', async () => {
        const server = controllableProducer<string>();
        const q = query(server.producer);

        const first = q.prime();
        expect(server.calls[0]!.aborted).toBe(false);
        q.reset();
        expect(server.calls[0]!.aborted).toBe(true); // the race guard aborted it

        server.resolve('late');
        await first;
        expect(q.phase).toBe('idle');
    });

    test('captures the arguments before the trailing signal', async () => {
        const server = controllableProducer<PageResult<Row, string>, [string | null]>();
        const pages = pagedCollection({ fetchPage: server.producer, key: (row: Row) => row.id });

        const firstPage = pages.loadMore();
        expect(server.lastCall.args).toEqual([null]); // page 0 anchors on no cursor
        server.resolve({ items: [{ id: 'a', title: 'A' }], nextCursor: 'c1' });
        await firstPage;

        const secondPage = pages.loadMore();
        expect(server.lastCall.args).toEqual(['c1']); // …page 1 on its predecessor's cursor
        server.resolve({ items: [{ id: 'b', title: 'B' }], nextCursor: null });
        await secondPage;

        expect(pages.items.map((row) => row.id)).toEqual(['a', 'b']);
        expect(pages.hasMore).toBe(false);
    });

    test('drives a collection fetch the same way', async () => {
        const server = controllableProducer<readonly Row[]>();
        const rows = collection({ fetch: server.producer, key: (row: Row) => row.id });

        const loading = rows.prime();
        expect(rows.phase).toBe('loading');
        server.resolve([{ id: 'a', title: 'A' }]);
        await loading;

        const stale = rows.items[0];
        const refreshing = rows.refresh();
        server.resolve([{ id: 'a', title: 'A renamed' }]);
        await refreshing;
        expect(rows.items[0]).toBe(stale); // reconciled in place, identity kept
        expect(rows.items[0]!.title).toBe('A renamed');
    });

    test('reports which call it cannot find', () => {
        const server = controllableProducer<number>();
        expect(() => server.resolve(1)).toThrow(/no such call yet \(0 call\(s\) made\)/);
    });
});

describe('controllableQuery', () => {
    test('is a real query — phases, and the source resolves with this very object', async () => {
        const q = controllableQuery<number>();
        const source = q.source();
        expect(source.getSnapshot()).toEqual({ status: 'pending' });

        const loading = q.prime();
        expect(q.phase).toBe('loading');
        q.resolve(42);
        await loading;

        expect(q.data).toBe(42);
        // The identity contract: an island receives this object, not an inner one.
        expect(source.getSnapshot()).toEqual({ status: 'ready', value: q });
    });

    test('drives a refresh failure onto stale data', async () => {
        const q = controllableQuery<readonly Row[]>();
        const first = q.prime();
        q.resolve([{ id: 'a', title: 'A' }]);
        await first;

        const failing = q.refresh();
        q.reject(new Error('offline'));
        await failing;

        expect(q.phase).toBe('error');
        expect(q.data).toEqual([{ id: 'a', title: 'A' }]); // the badge case
        expect(q.error).toMatchObject({ code: 'failed', message: 'offline' });
        expect(q.callCount).toBe(2);
    });

    test('steps the debounced path under fake timers', async () => {
        vi.useFakeTimers();
        const q = controllableQuery<string>({ debounce: { waitMs: 100 } });

        const burst = q.refresh();
        void q.refresh();
        expect(q.callCount).toBe(0); // nothing fired yet — still coalescing
        await vi.advanceTimersByTimeAsync(100);
        expect(q.callCount).toBe(1); // one fetch for the whole burst

        q.resolve('typed');
        await burst;
        expect(q.data).toBe('typed');
    });

    // `controllableQuery`'s producer reads nothing observable, so `reactive: true`
    // on it has nothing to track — the tracked read is the *producer's* business.
    // The reactive path is therefore stepped with `controllableProducer` inside a
    // producer that does the reading.
    test('steps the reactive path, the tracked read in the test’s own producer', async () => {
        const filter = observable({ term: 'a' });
        const server = controllableProducer<string>();
        const seen: string[] = [];
        const q = query(
            (signal) => {
                seen.push(filter.term); // read synchronously → tracked
                return server.producer(signal);
            },
            { reactive: true },
        );

        const first = q.prime();
        server.resolve('result:a');
        await first;
        expect(seen).toEqual(['a']);

        runInAction(() => {
            filter.term = 'b';
        });
        const refetch = q.prime(); // joins the reactive re-fetch
        server.resolve('result:b');
        await refetch;
        expect(seen).toEqual(['a', 'b']);
        expect(q.data).toBe('result:b');
    });
});

/*
    The Verify's store-level test: a store as an app would write it (a plain `query`
    over an injected fetch), tested with nothing hand-rolled — no gate array, no call
    counter, no `let signal`.
*/
interface Settings {
    retentionDays: number;
}

class SettingsStore {
    readonly settings: Query<Settings>;

    constructor(fetchSettings: (signal: AbortSignal) => Promise<Settings>) {
        this.settings = query(fetchSettings);
    }

    get retentionDays(): number {
        return this.settings.data?.retentionDays ?? 30;
    }
}

describe('a store test with only the helpers', () => {
    test('a failed refresh keeps the last good settings on screen', async () => {
        const server = controllableProducer<Settings>();
        const store = new SettingsStore(server.producer);

        const loading = store.settings.prime();
        server.resolve({ retentionDays: 7 });
        await loading;
        expect(store.retentionDays).toBe(7);

        const failing = store.settings.refresh();
        server.reject(new Error('offline'));
        await failing;

        expect(store.retentionDays).toBe(7); // stale-but-good, not the default
        expect(store.settings.error).toMatchObject({ code: 'failed' });
        expect(server.callCount).toBe(2);
    });
});
