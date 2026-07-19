import { describe, test, expect, afterEach, vi } from 'vite-plus/test';
import { act, useSyncExternalStore, type FC } from 'react';
import { scope, hook } from '../../scope/scope';
import { controllableSource, deferred, flush, renderIsland, cleanup } from '../../testing';

/*
    The Suspense-produced situations React makes possible around a committed island —
    pins 10-12 of docs/archive/mandala-testing.md §"Deterministic pins", one per
    situation in ../suspense-situations.md (S4, S5, S8). Each carries a *kill note*: the
    one-line source mutation that must make it fail, executed once at authoring and
    reverted.

    They are grouped here rather than in scopeControls.test.tsx (the strategy doc's
    suggested home) because none of them involves the controls: what they share is the
    catalog, and reading them next to it is what makes them legible.

    The altitude these assert at is deliberately low-commitment (§"The altitude rule"):
    the ledger's *bounds* (never a second attach of a live entry; balanced at teardown),
    not its exact event sequence. Whether the engine keeps a source attached through a
    hide or cycles it is its own business — S4/S8 say so explicitly — so pinning the
    sequence would freeze an implementation nicety into a promise.

    A `controllableSource`'s transitions must drive an **async** act (`act(async () =>
    source.setReady(v))`) and be awaited: S2's rule for the mount is really about any act
    that (re-)suspends, and a source transition can be one — here a ready source lets the
    waterfall reach a level whose hook load `use()`es a promise React has not seen, which
    suspends. Under a sync act that retry is never delivered and the island sits on the
    loading slot forever.
*/

const Loading: FC = () => <div>loading...</div>;

afterEach(cleanup);

/*
    The attach/detach ledger read off the source's own counters, as *bounds* rather than a
    transcript: `live` is what is attached right now, `peak` the most that was ever attached
    at once. For a single source, `peak > 1` is a double attach of a live entry (the
    contract's line), and `live > 0` after teardown is a leak.
*/
function ledger(source: { attachCount: number; detachCount: number; peakAttached: number }) {
    return { live: source.attachCount - source.detachCount, peak: source.peakAttached };
}

// An external store holding the promise a hook load hands back — the test swaps in a
// fresh pending one to re-suspend a Step that has already committed (S4's way in).
function promiseStore(initial: Promise<string>) {
    let current = initial;
    const listeners = new Set<() => void>();
    return {
        getSnapshot: () => current,
        subscribe: (onChange: () => void) => {
            listeners.add(onChange);
            return () => {
                listeners.delete(onChange);
            };
        },
        set(next: Promise<string>) {
            current = next;
            for (const listener of listeners) listener();
        },
    };
}

describe('S4 — re-suspension of committed content', () => {
    // Pin 10. A hook load returning a fresh pending promise re-suspends a *committed*
    // Step. React does not unmount the content — it hides it (Offscreen), destroys the
    // subtree's effects and re-runs them on reveal. What must survive that cycle: the
    // ledger's bounds, the content, and the data cells (only the hook load re-ran —
    // the producers are cached on the mandala's buckets).
    //
    // Kill: resolver.tsx, the Step's layout attach — drop the `if (!entry.detach)`
    // guard → a reveal re-runs the attach loop over an entry that never detached, and
    // `peak` is 2: a double attach of a live entry. (It dies on the *first* hide/reveal,
    // the one the label's initial suspension causes on the way to content — the explicit
    // re-suspension below is the second.)
    test('a hook load re-suspending hides and reveals content without double-attaching or re-running producers', async () => {
        const feed = controllableSource<string>();
        let itemRuns = 0;
        const store = promiseStore(Promise.resolve('label-1'));
        const testScope = scope()
            .load({
                feed: () => feed,
                item: async () => {
                    itemRuns++;
                    return 'item';
                },
            })
            .load({
                // Re-runs every render and hands back whatever promise the store holds.
                label: hook(() => useSyncExternalStore(store.subscribe, store.getSnapshot)),
            });
        const handle = await renderIsland({
            scope: testScope,
            component: ({
                feed: f,
                item,
                label,
            }: {
                feed: string;
                item: string;
                label: string;
            }) => (
                <div>
                    <span>
                        {f}/{item}/{label}
                    </span>
                </div>
            ),
            loading: Loading,
        });

        await act(async () => feed.setReady('live'));
        await flush();
        expect(handle.text()).toBe('live/item/label-1');
        expect(itemRuns).toBe(1);
        expect(ledger(feed)).toEqual({ live: 1, peak: 1 });

        // The committed Step suspends again on a fresh pending promise.
        const next = deferred<string>();
        await act(async () => {
            store.set(next.promise);
        });
        expect(handle.slot()).toBe('loading');
        // Hidden, not unmounted — but either way nothing may attach twice.
        expect(ledger(feed).peak).toBe(1);

        await act(async () => {
            next.resolve('label-2');
        });
        await flush(2);

        // Content is back on the new label, and the source that feeds it is attached.
        expect(handle.text()).toBe('live/item/label-2');
        expect(ledger(feed)).toEqual({ live: 1, peak: 1 });
        // Only the hook load re-ran: the data cells are cached, so no re-fetch.
        expect(itemRuns).toBe(1);

        cleanup();
        expect(ledger(feed)).toEqual({ live: 0, peak: 1 });
    });
});

describe('S5 — unmount while suspended', () => {
    // Pin 11. The island unmounts (navigation) with a load still in flight; the promise
    // settles into a tree that no longer exists. That late settle must be inert — no
    // throw, no log noise, nothing written anywhere observable — and the level's source,
    // which was *created* at bucket build but never attached (the Step suspended before
    // the resolve loop reached it, so it never committed — S12), is balanced at 0/0.
    //
    // Kill: refresh.ts `sweepDetach()` — `if (entry.detach) {` → `if (true) {` (the
    // sweep assuming every source in a bucket attached) → it calls a null detach on the
    // never-attached entry, and the caught TypeError logs 'Source detach failed'.
    test('a late settle into a discarded tree is inert; a never-attached source is balanced at 0/0', async () => {
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const slow = deferred<string>();
        // Both cells are built when the level builds, but the resolve loop suspends on
        // `slow` before it reads `feed` — so the Step never commits and `feed`, though
        // created, is never attached.
        const feed = controllableSource<string>();
        const testScope = scope().load({
            slow: () => slow.promise,
            feed: () => feed,
        });
        const handle = await renderIsland({
            scope: testScope,
            component: ({ slow: s, feed: f }: { slow: string; feed: string }) => (
                <div>
                    {s}/{f}
                </div>
            ),
            loading: Loading,
        });
        expect(handle.slot()).toBe('loading');
        expect(feed.attachCount).toBe(0);

        handle.unmount();
        // The load settles after the tree is gone.
        await act(async () => {
            slow.resolve('too late');
        });
        await flush();

        expect(ledger(feed)).toEqual({ live: 0, peak: 0 });
        expect(errorSpy).not.toHaveBeenCalled();
        expect(warnSpy).not.toHaveBeenCalled();
        errorSpy.mockRestore();
        warnSpy.mockRestore();
    });
});

describe('S8 — a mid-tree source dropping to pending', () => {
    // Pin 12. Unlike S4's hide, a committed source going ready → pending renders the
    // loading slot as ordinary children: the levels below unmount for real. Their data
    // cells stay cached on the mandala's buckets, so recovering onto the same value
    // renders them again with **no producer re-runs** (reference.md §Sources states
    // exactly this). The deeper source's attach/detach churn through the window is the
    // engine's choice — only the bounds are asserted (S8).
    //
    // Kill: resolver.tsx, the source-snapshot gate in the resolve loop — `if
    // (!equals(cell.lastValue, state.value))` → `if (true)` → the recovery blip is
    // called a change, cascades, and `derived` re-runs.
    test('recovering onto the same value re-renders the levels below with no producer re-runs', async () => {
        const feed = controllableSource<string>();
        const deep = controllableSource<string>();
        let derivedRuns = 0;
        const testScope = scope()
            .load({ feed: () => feed })
            .load({
                derived: ({ feed: f }: { feed: string }) => {
                    derivedRuns++;
                    return `d(${f})`;
                },
                deep: () => deep,
            });
        const handle = await renderIsland({
            scope: testScope,
            component: ({ derived, deep: d }: { derived: string; deep: string }) => (
                <div>
                    <span>
                        {derived}/{d}
                    </span>
                </div>
            ),
            loading: Loading,
        });

        await act(async () => feed.setReady('v1'));
        await act(async () => deep.setReady('deep-1'));
        expect(handle.text()).toBe('d(v1)/deep-1');
        expect(derivedRuns).toBe(1);
        expect(ledger(deep)).toEqual({ live: 1, peak: 1 });

        // The mid-tree source blips: the levels below go away for real.
        await act(async () => feed.setPending());
        expect(handle.slot()).toBe('loading');
        expect(ledger(deep).peak).toBe(1);

        // …and recovers onto the value it already had.
        await act(async () => feed.setReady('v1'));

        expect(handle.text()).toBe('d(v1)/deep-1');
        // The cached cell rendered again; the producer never ran a second time.
        expect(derivedRuns).toBe(1);
        expect(ledger(deep).peak).toBe(1);

        cleanup();
        expect(ledger(deep)).toEqual({ live: 0, peak: 1 });
        expect(ledger(feed)).toEqual({ live: 0, peak: 1 });
    });

    // The mandala's unmount sweep, tested where it is the only thing that can work — the
    // sweep half of pin 8, which has nothing to do with StrictMode. A Step torn down
    // while its bucket is still live keeps its sources attached on purpose (it cannot
    // tell a source swap from an unmount, so it defers to the sweep). Unmount *during*
    // the pending window and those Steps are already gone: no cleanup of theirs will
    // ever run again, and `deep` is attached with nobody but the sweep to release it.
    //
    // (Every other unmount path is redundant with the Step's own cleanup, which is why
    // the pin was originally written against one and the kill below did not fire: the
    // mandala's cleanup nulls the cache *before* the children's cleanups run, so a
    // still-mounted Step sees `currentBuckets() === null`, calls its bucket dead, and
    // detaches everything itself.)
    //
    // Kill: mandala.tsx, the unmount effect's cleanup — drop
    // `sweepDetach(cacheRef.current?.buckets)` → `deep` is never detached: live 1.
    test('unmounting during the pending window releases what the torn-down levels kept', async () => {
        const feed = controllableSource<string>();
        const deep = controllableSource<string>();
        const testScope = scope()
            .load({ feed: () => feed })
            .load({
                derived: ({ feed: f }: { feed: string }) => `d(${f})`,
                deep: () => deep,
            });
        const handle = await renderIsland({
            scope: testScope,
            component: ({ derived, deep: d }: { derived: string; deep: string }) => (
                <div>
                    <span>
                        {derived}/{d}
                    </span>
                </div>
            ),
            loading: Loading,
        });

        await act(async () => feed.setReady('v1'));
        await act(async () => deep.setReady('deep-1'));
        expect(handle.text()).toBe('d(v1)/deep-1');

        // The blip tears the level below down; its source stays attached, deferred.
        await act(async () => feed.setPending());
        expect(handle.slot()).toBe('loading');
        expect(ledger(deep)).toEqual({ live: 1, peak: 1 });

        // The island goes away with the window still open.
        cleanup();
        expect(ledger(deep)).toEqual({ live: 0, peak: 1 });
        expect(ledger(feed)).toEqual({ live: 0, peak: 1 });
    });
});
