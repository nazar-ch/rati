import { describe, test, expect, afterEach } from 'vite-plus/test';
import { render, screen, cleanup, act } from '@testing-library/react';
import { StrictMode, type FC } from 'react';
import { scope } from '../../scope/scope';
import { island } from '../../island/island';
import { useScopeControls, type ScopeControls } from '../../mandala/controls';
import { controllableSource, type ControllableSource } from '../../testing';

/*
    Pin 8 (docs/archive/mandala-testing.md §"Deterministic pins"): StrictMode accounting
    for the machinery the selective-refresh / SSR-sources work added. island.test.tsx
    pins the double-mount for the *old* lifecycle (the surviving run's identities, the
    discarded run's dispose-before-detach); what needs its own home is what the rework
    changed — a refresh reaching the surviving run and swapping a source there, across
    two generations, all of it released at the end.

    Dev StrictMode mounts → cleans up → remounts; the mandala drops its cache on the fake
    unmount and rebuilds, so producers legitimately run once per generation (S7).

    Two harness rules bound what a StrictMode test here can even ask, both learned the
    expensive way:

      - `<StrictMode>` must be the element `render()` gets. One component deeper, React
        double-*renders* but skips the double-*mount* — no cleanup, no re-run — and the
        test silently asserts nothing about the lifecycle it exists for (MF-03).
      - The second generation only reaches the levels the *initial mount* reached. A
        level behind a pending promise is first built when that promise settles, which is
        after the double-mount is over, so it sees one generation however deep the scope
        is. A test that wants a *dependent* level doubled needs its upstream to resolve
        synchronously — hence the sync `v` below. (This is the fuzz smoke property's
        run-count range, stated the other way round: `fuzz/mandala.smoke.fuzz.test.tsx`
        §runCountBound.)

    Pin 8's other two thirds are not here, and the README's MF-05 finding says why:

      - "SSR-seeded cells" under the double-mount has no test because it has no
        situation. Cells come off the wire only on a hydration root, and a hydration root
        does not double-mount at all — measured, not assumed (a ready source at level 0
        under `hydrateRoot(<StrictMode>…)` builds exactly one generation).
      - "the unmount sweep" is not a StrictMode subject: at every unmount a mounted Step
        can see, the Step's own cleanup already detaches everything (the mandala's
        cleanup nulls the cache first, so the Step calls its bucket dead). The sweep is
        load-bearing only for buckets whose Steps are *already gone* — pinned where that
        happens, in suspenseEdges.test.tsx §S8.

    The test carries a *kill note*: the one-line source mutation that must make it fail,
    executed once at authoring and reverted.
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
    // A refresh reaches the *surviving* run — the controller is wired to the live
    // buckets, not the discarded generation's — and its cascade swaps the dependent
    // source there: three instances across two generations and a swap, each attached
    // once and each released.
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
