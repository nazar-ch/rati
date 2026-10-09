import { describe, test, expect, afterEach } from 'vite-plus/test';

import { StrictMode, type FC } from 'react';

import { render, screen, cleanup, act } from '@testing-library/react';

import { island } from '../../island/island.js';
import { useScopeControls, type ScopeControls } from '../../mandala/controls.js';
import { scope } from '../../scope/scope.js';
import { controllableSource, type ControllableSource } from '../../testing/index.js';

/*
    long:2
    Pin 8: StrictMode accounting for selective refresh. island.test.tsx pins the double-mount
    for the base lifecycle; this file pins a refresh reaching the surviving run and swapping a
    source there, across two generations, all of it released at the end. Dev StrictMode mounts,
    cleans up and remounts, so producers run once per generation (S7).

      - `<StrictMode>` must be the element `render()` gets: one component deeper, React
        double-RENDERS but skips the double-MOUNT, and the test asserts nothing.
      - The second generation reaches only the levels the INITIAL mount reached, so a test
        doubling a dependent level resolves its upstream synchronously — the sync `v` below.

    A hydration root never double-mounts, and the unmount sweep is suspenseEdges.test.tsx's.
*/

const Loading: FC = () => <div>loading...</div>;

afterEach(cleanup);

// Attach/detach as bounds, not a transcript (see suspenseEdges.test.tsx), read off the
// source's own counters: `live` is what is attached now, `peak` the most ever attached at
// once — 2 is a double attach.
function ledger(source: ControllableSource<string>) {
    return { live: source.attachCount - source.detachCount, peak: source.peakAttached };
}

function probeControls<S extends Parameters<typeof useScopeControls>[0]>(testScope: S) {
    const captured: { current: ScopeControls<S> | null } = { current: null };
    const Probe: FC = () => {
        captured.current = useScopeControls(testScope);
        return null;
    };
    return { captured, Probe };
}

describe('StrictMode — the refresh machinery', () => {
    // long:2
    // A refresh reaches the SURVIVING run's live buckets, and its cascade swaps the
    // dependent source there: three instances across two generations and a swap, each
    // attached once and released.
    //
    // Kill: resolver.tsx `processDirtyCells()`, the source-swap branch — drop the
    // `.filter(…)` that evicts the leaver, keeping only the `.concat(…)` → the swapped-out
    // source stays in the level's array, so its Step keeps it attached (a live bucket
    // still holds it) and it feeds nothing for the rest of the island's life: live 1.
    test('a refresh-driven source swap on the surviving run is released at teardown', async () => {
        // One source instance per generation — the double-mount and the swap between them
        // build three, and each carries its own ledger so the generations stay distinct.
        const sources: ControllableSource<string>[] = [];
        let version = 1;
        const testScope = scope()
            // Sync, so the initial mount reaches the level below and the double-mount
            // rebuilds it too (see the header).
            .load({ v: () => version })
            .load({
                live: ({ v }: { v: number }) => {
                    const source = controllableSource<string>({ initial: `s${v}` });
                    sources.push(source);
                    return source;
                },
            });
        const { captured, Probe } = probeControls(testScope);
        const Island = island({
            scope: testScope,
            component: ({ live }: { live: string }) => (
                <div>
                    <span>live {live}</span>
                    <Probe />
                </div>
            ),
            loading: Loading,
        });

        await act(async () => {
            render(
                <StrictMode>
                    <Island />
                </StrictMode>,
            );
        });
        expect(screen.getByText('live s1')).toBeTruthy();

        // Two generations, two instances: the discarded run's is already released, and
        // the survivor's is attached exactly once.
        expect(sources).toHaveLength(2);
        expect(ledger(sources[0]!)).toEqual({ live: 0, peak: 1 });
        expect(ledger(sources[1]!)).toEqual({ live: 1, peak: 1 });

        version = 2;
        await act(async () => {
            await captured.current!.refresh('v');
        });

        // The refresh found the surviving run, and its cascade swapped the source there.
        expect(screen.getByText('live s2')).toBeTruthy();
        expect(sources).toHaveLength(3);
        expect(ledger(sources[1]!)).toEqual({ live: 0, peak: 1 });
        expect(ledger(sources[2]!)).toEqual({ live: 1, peak: 1 });

        cleanup();
        for (const source of sources) expect(ledger(source)).toEqual({ live: 0, peak: 1 });
    });
});
