import { describe, test, expect, afterEach, vi } from 'vite-plus/test';

import { autorun, observable, runInAction } from 'mobx';

import { query } from '../../data/query';
// A deferred fake walks a query through every phase without module mocking — the
// "testability by construction" ground rule (data-package.md), now `rati/testing`'s.
// `controllableProducer` is the same idea for a *sequence* of fetches: the gate array
// plus call counter this file used to spell out by hand, with each call's signal on it.
import { deferred } from '../../testing';
import { controllableProducer } from '../../testing/data';

afterEach(() => {
    vi.useRealTimers();
});

describe('query phases', () => {
    test('walks idle → loading → ready', async () => {
        const gate = deferred<number>();
        const q = query(() => gate.promise);
        expect(q.phase).toBe('idle');
        expect(q.data).toBeUndefined();

        const loading = q.prime();
        expect(q.phase).toBe('loading');
        expect(q.isPending).toBe(true);

        gate.resolve(42);
        await loading;
        expect(q.phase).toBe('ready');
        expect(q.data).toBe(42);
        expect(q.error).toBeNull();
        expect(q.isPending).toBe(false);
    });

    test('a failed first load is error with no data; retrying shows loading, not refreshing', async () => {
        const server = controllableProducer<number>();
        const q = query(server.producer);

        const first = q.prime();
        server.reject(new Error('boom'));
        await first;
        expect(q.phase).toBe('error');
        expect(q.error).toMatchObject({ code: 'failed', message: 'boom' });
        expect(q.data).toBeUndefined();

        // prime() fetches from `error` (the ensure pair covers retry)…
        const second = q.prime();
        // …and with no data yet the pending phase reads loading.
        expect(q.phase).toBe('loading');
        server.resolve(7);
        await second;
        expect(q.phase).toBe('ready');
        expect(q.error).toBeNull();
    });
});

describe('prime() is ensure', () => {
    test('no-ops when ready, dedupes in flight', async () => {
        const producer = vi.fn(() => Promise.resolve('value'));
        const q = query(producer);

        const a = q.prime();
        const b = q.prime();
        expect(b).toBe(a); // the in-flight promise is returned, not a second fetch
        await a;
        expect(producer).toHaveBeenCalledTimes(1);

        await q.prime(); // ready → no-op
        expect(producer).toHaveBeenCalledTimes(1);
    });
});

describe('refresh()', () => {
    test('keeps data visible while re-fetching', async () => {
        const server = controllableProducer<number>();
        const q = query(server.producer);

        const first = q.prime();
        server.resolve(1);
        await first;

        const second = q.refresh();
        expect(q.phase).toBe('refreshing');
        expect(q.data).toBe(1); // stale value stays on screen
        server.resolve(2);
        await second;
        expect(q.data).toBe(2);
        expect(q.phase).toBe('ready');
    });

    test('a refresh failure keeps the stale data alongside the error', async () => {
        const server = controllableProducer<number>();
        const q = query(server.producer);

        const first = q.prime();
        server.resolve(1);
        await first;

        const failing = q.refresh();
        server.reject(new Error('offline'));
        await failing;
        expect(q.phase).toBe('error');
        expect(q.data).toBe(1); // the component shows the stale list plus an error badge
        expect(q.error).toMatchObject({ code: 'failed', message: 'offline' });

        // prime() from error re-fetches and recovers.
        const recovering = q.prime();
        expect(q.phase).toBe('refreshing'); // data present → not loading
        server.resolve(3);
        await recovering;
        expect(q.phase).toBe('ready');
        expect(q.data).toBe(3);
        expect(q.error).toBeNull();
    });
});

describe('set() and patch() — the single-value write seam', () => {
    test('patch swaps the reference and notifies an observer', async () => {
        const q = query(() => Promise.resolve({ retention: 30, role: 'admin' }));
        await q.prime();

        const seen: number[] = [];
        const dispose = autorun(() => seen.push(q.data!.retention));
        q.patch((current) => ({ ...current, retention: 7 }));
        dispose();

        expect(q.data).toEqual({ retention: 7, role: 'admin' });
        expect(seen).toEqual([30, 7]); // the ref swap is the notification
        expect(q.phase).toBe('ready'); // no fetch started, no phase change
    });

    test('patch before the first value no-ops', () => {
        const q = query(() => Promise.resolve(1));
        q.patch((current) => current + 1);
        expect(q.data).toBeUndefined();
        expect(q.phase).toBe('idle');
    });

    test('set lands a value from idle; source() becomes ready (the server-push seam)', () => {
        const q = query(() => Promise.resolve(1));
        const source = q.source();
        expect(source.getSnapshot()).toEqual({ status: 'pending' });

        q.set(42);
        expect(q.data).toBe(42);
        expect(q.phase).toBe('ready');
        expect(source.getSnapshot()).toEqual({ status: 'ready', value: q });
    });

    test('set does not touch a standing error (a local write is no evidence of recovery)', async () => {
        const server = controllableProducer<number>();
        const q = query(server.producer);
        const first = q.prime();
        server.resolve(1);
        await first;
        const failing = q.refresh();
        server.reject(new Error('offline'));
        await failing;

        q.set(2);
        expect(q.data).toBe(2);
        expect(q.error).toMatchObject({ code: 'failed' }); // only a settle clears it
    });

    test('a refresh overwrites the patched value wholesale — the recovery path', async () => {
        const server = controllableProducer<number>();
        const q = query(server.producer);
        const first = q.prime();
        server.resolve(10);
        await first;

        q.patch(() => 99); // optimistic hop
        expect(q.data).toBe(99);

        const refreshing = q.refresh(); // e.g. mutation onError: 'refresh'
        server.resolve(10); // server truth unchanged
        await refreshing;
        expect(q.data).toBe(10); // no dirty-mark needed: refresh replaces the ref
    });

    test('a patch during an in-flight refresh loses to the settle (last-write-wins)', async () => {
        const server = controllableProducer<number>();
        const q = query(server.producer);
        const first = q.prime();
        server.resolve(1);
        await first;

        const refreshing = q.refresh();
        q.patch(() => 5); // visible immediately…
        expect(q.data).toBe(5);
        server.resolve(2);
        await refreshing;
        expect(q.data).toBe(2); // …until the settle brings server truth
    });
});

describe('race guard and abort', () => {
    test('reset() aborts the in-flight fetch and its late settle is ignored', async () => {
        const server = controllableProducer<string>();
        const q = query(server.producer);

        const loading = q.prime();
        expect(server.calls[0]!.aborted).toBe(false);
        q.reset();
        expect(server.calls[0]!.aborted).toBe(true);
        expect(q.phase).toBe('idle');

        server.resolve('late');
        await loading;
        expect(q.phase).toBe('idle'); // the superseded settle went into the void
        expect(q.data).toBeUndefined();
    });

    test('a superseded fetch cannot clobber the current one', async () => {
        const server = controllableProducer<string>();
        const q = query(server.producer);

        const first = q.prime();
        q.reset();
        const second = q.prime();
        server.resolve('old'); // the superseded call — oldest first
        server.resolve('new');
        await Promise.all([first, second]);
        expect(q.data).toBe('new');
    });
});

describe('debounce', () => {
    test('coalesces a refresh burst into one fetch sharing one promise', async () => {
        vi.useFakeTimers();
        const producer = vi.fn(() => Promise.resolve('value'));
        const q = query(producer, { debounce: { waitMs: 100 } });

        const a = q.refresh();
        await vi.advanceTimersByTimeAsync(50);
        const b = q.refresh();
        expect(b).toBe(a);
        expect(q.isPending).toBe(true); // a fetch is imminent — honest phase
        expect(producer).not.toHaveBeenCalled();

        // 100ms after the *last* call, not the first.
        await vi.advanceTimersByTimeAsync(99);
        expect(producer).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
        expect(producer).toHaveBeenCalledTimes(1);
        await a;
        expect(q.phase).toBe('ready');
    });

    test('maxWaitMs bounds a continuous burst', async () => {
        vi.useFakeTimers();
        const producer = vi.fn(() => Promise.resolve('value'));
        const q = query(producer, { debounce: { waitMs: 100, maxWaitMs: 250 } });

        void q.refresh();
        // Keep typing every 50ms — the plain wait alone would postpone forever.
        for (let i = 0; i < 4; i++) {
            await vi.advanceTimersByTimeAsync(50);
            void q.refresh();
        }
        await vi.advanceTimersByTimeAsync(50); // t = 250 from the first call
        expect(producer).toHaveBeenCalledTimes(1);
    });

    test('prime() joins a scheduled fetch instead of jumping the queue', async () => {
        vi.useFakeTimers();
        const producer = vi.fn(() => Promise.resolve('value'));
        const q = query(producer, { debounce: { waitMs: 100 } });

        const scheduled = q.refresh();
        expect(q.prime()).toBe(scheduled);
        expect(producer).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(100);
        expect(producer).toHaveBeenCalledTimes(1);
    });

    test('reset() cancels a scheduled fetch and resolves its promise', async () => {
        vi.useFakeTimers();
        const producer = vi.fn(() => Promise.resolve('value'));
        const q = query(producer, { debounce: { waitMs: 100 } });

        const scheduled = q.refresh();
        q.reset();
        await scheduled; // resolves, not hangs
        await vi.advanceTimersByTimeAsync(200);
        expect(producer).not.toHaveBeenCalled();
        expect(q.phase).toBe('idle');
    });
});

describe('source()', () => {
    test('pending until the first ready, then ready forever with the instance', async () => {
        const server = controllableProducer<number>();
        const q = query(server.producer);
        const source = q.source();
        expect(q.source()).toBe(source); // memoized

        expect(source.getSnapshot()).toEqual({ status: 'pending' });

        // attach() triggers prime() (ensure semantics).
        const detach = source.attach();
        expect(q.phase).toBe('loading');
        server.resolve(1);
        await q.prime();
        expect(source.getSnapshot()).toEqual({ status: 'ready', value: q });

        // A refresh failure is the instance's own state — the island never re-trips.
        const failing = q.refresh();
        server.reject(new Error('offline'));
        await failing;
        expect(q.phase).toBe('error');
        expect(source.getSnapshot()).toEqual({ status: 'ready', value: q });
        detach(); // no-op: the store owns the data's lifetime
    });

    test('an error before the first ready surfaces to the error slot', async () => {
        const gate = deferred<number>();
        const q = query(() => gate.promise);
        const source = q.source();
        source.attach();
        const loading = q.prime(); // joins the fetch attach() started
        gate.reject(new Error('down'));
        await loading;
        expect(source.getSnapshot()).toMatchObject({
            status: 'error',
            error: { code: 'failed', message: 'down' },
        });
    });

    test('subscribe fires on the pending → ready transition', async () => {
        const gate = deferred<number>();
        const q = query(() => gate.promise);
        const source = q.source();
        const onChange = vi.fn();
        const unsubscribe = source.subscribe(onChange);
        const loading = q.prime();
        gate.resolve(5);
        await loading;
        expect(onChange).toHaveBeenCalled();
        unsubscribe();
    });

    test('unsubscribe stops delivery while a still-subscribed listener keeps firing', async () => {
        const server = controllableProducer<number>();
        const q = query(server.producer);
        const source = q.source();

        const dropped = vi.fn();
        const kept = vi.fn();
        const unsubscribe = source.subscribe(dropped);
        const keptUnsubscribe = source.subscribe(kept);

        const loading = q.prime();
        server.resolve(5);
        await loading;
        expect(dropped).toHaveBeenCalledTimes(1); // both saw pending → ready
        expect(kept).toHaveBeenCalledTimes(1);

        unsubscribe(); // drop the first listener…

        q.reset(); // ready → pending: a real transition the derivation reports
        expect(dropped).toHaveBeenCalledTimes(1); // …it received nothing more
        expect(kept).toHaveBeenCalledTimes(2); // …while the live one fired again
        keptUnsubscribe();
    });
});

describe('reactive', () => {
    test('a change to a tracked read re-fetches', async () => {
        const store = observable({ term: 'a' });
        const seen: string[] = [];
        const q = query(
            async () => {
                seen.push(store.term); // read synchronously → tracked
                return `result:${store.term}`;
            },
            { reactive: true },
        );

        await q.prime(); // establishes tracking, reads term 'a'
        expect(q.data).toBe('result:a');
        expect(seen).toEqual(['a']);

        runInAction(() => {
            store.term = 'b';
        });
        await q.prime(); // await the reactive re-fetch (joins the in-flight one)
        expect(q.data).toBe('result:b');
        expect(seen).toEqual(['a', 'b']);
    });

    test('reads after the first await are not tracked (the synchronous-prefix boundary)', async () => {
        const store = observable({ tracked: 'a', untracked: 'x' });
        const q = query(
            async () => {
                const before = store.tracked; // before the await → tracked
                await Promise.resolve();
                const after = store.untracked; // after the await → NOT tracked
                return `${before}:${after}`;
            },
            { reactive: true },
        );

        await q.prime();
        expect(q.data).toBe('a:x');

        // Changing the post-await read does not re-fetch.
        runInAction(() => {
            store.untracked = 'y';
        });
        await Promise.resolve();
        await Promise.resolve();
        expect(q.data).toBe('a:x');

        // Changing the pre-await read does — and now picks up untracked 'y' too.
        runInAction(() => {
            store.tracked = 'b';
        });
        await q.prime();
        expect(q.data).toBe('b:y');
    });

    test('a tracked change while loading supersedes the in-flight fetch, not dedupes it', async () => {
        const store = observable({ term: 'a' });
        const gates = [deferred<void>(), deferred<void>()];
        let call = 0;
        const q = query(
            async () => {
                const term = store.term; // tracked
                const gate = gates[call++]!;
                await gate.promise;
                return `result:${term}`;
            },
            { reactive: true },
        );

        const first = q.prime(); // fetch #0 for 'a', in flight
        expect(q.isPending).toBe(true);

        runInAction(() => {
            store.term = 'b'; // reactive → aborts #0, starts fetch #1 for 'b'
        });
        gates[0]!.resolve(); // #0 settles late — superseded, ignored
        gates[1]!.resolve();
        await Promise.all([first, q.prime()]);
        expect(q.data).toBe('result:b');
        expect(call).toBe(2); // two real fetches — the change was not deduped away
    });

    test('reactive + debounce coalesces a burst into one fetch reading the latest value', async () => {
        vi.useFakeTimers();
        const store = observable({ term: 'a' });
        const producer = vi.fn(async () => `result:${store.term}`);
        const q = query(producer, { reactive: true, debounce: { waitMs: 100 } });

        await q.prime(); // prime() never debounces
        expect(producer).toHaveBeenCalledTimes(1);
        expect(q.data).toBe('result:a');

        runInAction(() => {
            store.term = 'ab';
        });
        await vi.advanceTimersByTimeAsync(30);
        runInAction(() => {
            store.term = 'abc';
        });
        await vi.advanceTimersByTimeAsync(30);
        runInAction(() => {
            store.term = 'abcd';
        });
        // Well past waitMs from the last change: one coalesced fetch, latest value.
        await vi.advanceTimersByTimeAsync(200);
        expect(producer).toHaveBeenCalledTimes(2);
        expect(q.data).toBe('result:abcd');
    });

    test('a plain (non-reactive) query never tracks', async () => {
        const store = observable({ term: 'a' });
        const producer = vi.fn(async () => store.term);
        const q = query(producer); // no reactive

        await q.prime();
        runInAction(() => {
            store.term = 'b';
        });
        await Promise.resolve();
        await Promise.resolve();
        expect(producer).toHaveBeenCalledTimes(1); // opt-in only — no implicit tracking
    });

    test('reset() disposes the reaction; tracking resumes on the next prime', async () => {
        const store = observable({ term: 'a' });
        const producer = vi.fn(async () => store.term);
        const q = query(producer, { reactive: true });
        await q.prime();
        expect(producer).toHaveBeenCalledTimes(1);

        q.reset();
        runInAction(() => {
            store.term = 'b'; // no live reaction → no fetch
        });
        await Promise.resolve();
        await Promise.resolve();
        expect(producer).toHaveBeenCalledTimes(1);
        expect(q.phase).toBe('idle');

        await q.prime(); // re-establishes tracking
        runInAction(() => {
            store.term = 'c';
        });
        await q.prime();
        expect(q.data).toBe('c');
    });

    test('a synchronous throw from a reactive producer lands on the error path (re-raised out of Reaction.track)', async () => {
        // A producer that throws before returning its promise: the throw happens
        // inside `Reaction.track`, whose own error boundary would swallow it — the
        // `caught` plumbing in `callProducer` re-raises it outside `track` so it
        // reaches the query's normal catch/error path.
        const q = query<number>(
            () => {
                throw new Error('sync boom');
            },
            { reactive: true },
        );

        await q.prime();
        expect(q.phase).toBe('error');
        expect(q.error).toMatchObject({ code: 'failed', message: 'sync boom' });
        expect(q.data).toBeUndefined();
    });
});
