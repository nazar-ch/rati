import { describe, test, expect, afterEach } from 'vite-plus/test';
import { render, screen, cleanup, act } from '@testing-library/react';
import { scope, input } from '../../scope/scope';
import { SourceSymbol, type Source, type SourceState } from '../../scope/source';
import { island } from '../../island/island';

/*
    A source must not leak when an inner-tree teardown is followed by a new generation —
    found by the MF-02 command property on its first run (it shrank to `reject(k3_1),
    changeInput` on a 4-level scope), then reduced to the two repros below and fixed.

    The mechanism the fix closes (resolver.tsx + mandala.tsx):

      1. A Step's detach effect deliberately keeps entries the *live* bucket still holds —
         it cannot tell a source swap from an unmount, so it defers to the mandala's sweep
         (`bucketIsLive && bucket.sources.includes(entry)` -> continue).
      2. So a Step torn down while its bucket is still current leaves its sources attached.
         Two ways in with no remount involved: a source erroring (the boundary swaps the
         subtree for the error slot), and a mid-tree source dropping to pending (S8 — the
         levels below unmount for real).
      3. A following generation (retry / input change) makes `cacheRef.current` a fresh
         bucket array. Before the fix the old buckets — still holding attached sources —
         were dropped on the floor, and `sweepDetach` on unmount only ever saw
         `cacheRef.current`. Nothing detached them, ever.

    The mandala now queues each replaced bucket array and sweeps it from the `treeCommitted`
    effect. The ordinary remount path never needed it: the mandala re-renders before the old
    Steps' cleanups run, so `currentBuckets()` already points at the new array, `bucketIsLive`
    is false, and everything detaches through the Steps themselves.
*/

afterEach(cleanup);

type TestSource<T> = Source<T> & { set: (state: SourceState<T>) => void };

function testSource<T>(log: string[], id: string): TestSource<T> {
    let state: SourceState<T> = { status: 'pending' };
    const listeners = new Set<() => void>();
    return {
        [SourceSymbol]: true,
        getSnapshot: () => state,
        subscribe(onChange) {
            listeners.add(onChange);
            return () => {
                listeners.delete(onChange);
            };
        },
        attach() {
            log.push(`attach:${id}`);
            return () => log.push(`detach:${id}`);
        },
        set: (next) => {
            state = next;
            for (const listener of listeners) listener();
        },
    };
}

const balanced = (log: string[], id: string) =>
    log.filter((entry) => entry === `attach:${id}`).length ===
    log.filter((entry) => entry === `detach:${id}`).length;

describe('teardown followed by a new generation releases its sources', () => {
    test('a source attached before an error detaches once the tree is replaced', async () => {
        const log: string[] = [];
        const live = testSource<string>(log, 'live');
        const testScope = scope({ n: input<string>() }).load({ feed: () => live });
        const Island = island({
            scope: testScope,
            component: ({ feed }: { feed: string }) => <span>feed {feed}</span>,
            loading: () => <div>loading...</div>,
            error: ({ error }) => <div>error {error.code}</div>,
        });

        const view = await act(async () => render(<Island n="a" />));
        expect(log).toContain('attach:live');

        // The source errors: the boundary swaps the subtree for the error slot. The Step's
        // cleanup keeps the entry (its bucket is still live) and defers to the sweep.
        await act(async () => {
            live.set({ status: 'error', error: { code: 'failed' } });
        });
        expect(screen.getByText('error failed')).toBeTruthy();

        // A new generation: `cacheRef` becomes a fresh bucket array, so the old one — still
        // holding the attached source — must be swept as it is replaced.
        view.rerender(<Island n="b" />);
        await act(async () => {});
        view.unmount();

        expect(balanced(log, 'live'), `unbalanced: ${log.join(' ')}`).toBe(true);
    });

    test('a source under a pending mid-tree source detaches once the tree is replaced', async () => {
        const log: string[] = [];
        const top = testSource<string>(log, 'top');
        const deep = testSource<string>(log, 'deep');
        const testScope = scope({ n: input<string>() })
            .load({ a: () => top })
            .load({ b: () => deep });
        const Island = island({
            scope: testScope,
            component: ({ b }: { b: string }) => <span>b {b}</span>,
            loading: () => <div>loading...</div>,
        });

        const view = await act(async () => render(<Island n="a" />));
        await act(async () => {
            top.set({ status: 'ready', value: 'up' });
        });
        await act(async () => {
            deep.set({ status: 'ready', value: 'down' });
        });
        expect(screen.getByText('b down')).toBeTruthy();
        expect(log).toContain('attach:deep');

        // S8: the mid-tree source drops to pending, so the level below unmounts for real.
        // Its cleanup keeps `deep` attached — the bucket is still live.
        await act(async () => {
            top.set({ status: 'pending' });
        });
        expect(screen.getByText('loading...')).toBeTruthy();

        // A new generation replaces that bucket, `deep` included. No error involved.
        view.rerender(<Island n="b" />);
        await act(async () => {});
        view.unmount();

        expect(balanced(log, 'deep'), `unbalanced: ${log.join(' ')}`).toBe(true);
    });
});
