import { describe, test, expect, afterEach } from 'vite-plus/test';
import { render, screen, cleanup, act } from '@testing-library/react';
import { scope, input } from '../../scope/scope';
import { island } from '../../island/island';
import { controllableSource, flush } from '../../testing';

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

describe('teardown followed by a new generation releases its sources', () => {
    test('a source attached before an error detaches once the tree is replaced', async () => {
        const live = controllableSource<string>();
        const testScope = scope({ n: input<string>() }).load({ feed: () => live });
        const Island = island({
            scope: testScope,
            component: ({ feed }: { feed: string }) => <span>feed {feed}</span>,
            loading: () => <div>loading...</div>,
            error: ({ error }) => <div>error {error.code}</div>,
        });

        const view = await act(async () => render(<Island n="a" />));
        expect(live.attached).toBe(true);

        // The source errors: the boundary swaps the subtree for the error slot. The Step's
        // cleanup keeps the entry (its bucket is still live) and defers to the sweep.
        await act(async () => {
            live.setError('failed');
        });
        expect(screen.getByText('error failed')).toBeTruthy();

        // A new generation: `cacheRef` becomes a fresh bucket array, so the old one — still
        // holding the attached source — must be swept as it is replaced.
        view.rerender(<Island n="b" />);
        await flush();
        view.unmount();

        expect(
            live.attached,
            `live leaked: ${live.attachCount} attach / ${live.detachCount} detach`,
        ).toBe(false);
    });

    test('a source under a pending mid-tree source detaches once the tree is replaced', async () => {
        const top = controllableSource<string>();
        const deep = controllableSource<string>();
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
            top.setReady('up');
        });
        await act(async () => {
            deep.setReady('down');
        });
        expect(screen.getByText('b down')).toBeTruthy();
        expect(deep.attached).toBe(true);

        // S8: the mid-tree source drops to pending, so the level below unmounts for real.
        // Its cleanup keeps `deep` attached — the bucket is still live.
        await act(async () => {
            top.setPending();
        });
        expect(screen.getByText('loading...')).toBeTruthy();

        // A new generation replaces that bucket, `deep` included. No error involved.
        view.rerender(<Island n="b" />);
        await flush();
        view.unmount();

        expect(
            deep.attached,
            `deep leaked: ${deep.attachCount} attach / ${deep.detachCount} detach`,
        ).toBe(false);
    });
});
