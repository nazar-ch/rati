import * as fc from 'fast-check';
import { describe, test, expect, afterEach } from 'vite-plus/test';
import { render, cleanup, act } from '@testing-library/react';
import { fuzz } from './arbitraries';
import { allKeys, createDeclaredState, createModel, type ScopeSpec } from './model';
import { buildHarness, readContent, readSlot, scopeSpecArb } from './scopeHarness';

/*
    The MF-01 smoke property: a generated scope mounts, its held loads settle one by one in a
    generated order, and at every step the island shows exactly what the reference model says —
    the loading slot until the last key, then content carrying the model's values (convergence).
    Teardown balance is asserted in a `finally`, so a lifecycle leak fails the run even when
    every mid-run assert passed. All asserts sit at the contract altitude
    (docs/research/mandala-testing.md §"The altitude rule").

    Initial resolution only — the event alphabet (refreshes, rejections, source transitions,
    remounts) is the MF-02 command property next door.
*/

afterEach(cleanup);

/** This property's settle policy: lowest `settleOrder` first, ties by key. The command
 * suite picks its own order, so the policy lives here rather than in the model. */
function nextToSettle(spec: ScopeSpec, held: string[]): string {
    const order = new Map(allKeys(spec).map((keySpec) => [keySpec.key, keySpec.settleOrder]));
    return [...held].sort((a, b) => order.get(a)! - order.get(b)! || (a < b ? -1 : 1))[0]!;
}

describe('mandala fuzz — smoke (initial resolution over generated scopes)', () => {
    test('a generated scope resolves to convergence, in any settle order', async () => {
        await fc.assert(
            fc.asyncProperty(scopeSpecArb(), async (spec) => {
                const declared = createDeclaredState();
                const harness = buildHarness(spec, declared);
                const model = createModel(spec, declared);
                // Mount inside an *async* act: under the sync act RTL wraps render() in,
                // React never delivers the Suspense retry for a promise resolved later —
                // the island stays on the loading slot forever (found by this property's
                // first run; the deterministic suites mount this way throughout).
                let view!: ReturnType<typeof render>;
                await act(async () => {
                    view = render(<harness.Host />);
                });
                try {
                    for (;;) {
                        // Slot correctness: content if and only if every key is ready
                        // (all-or-nothing resolution), the loading slot otherwise.
                        expect(readSlot(view.container)).toBe(model.slot());

                        // The held frontiers agree: exactly the model-predicted loads are
                        // in flight (a producer running early or late shows up here).
                        expect(harness.held()).toEqual(model.held());

                        if (model.allReady()) break;
                        const key = nextToSettle(spec, model.held());
                        model.settle(key);
                        await act(async () => {
                            harness.settle(key);
                        });
                        // A resolved `use()` promise re-renders on the Suspense retry, which
                        // React schedules a tick after the resolution — flush it before
                        // asserting (deterministic: always one flush, never poll-until-green).
                        await act(async () => {});
                    }

                    // Convergence: the rendered values equal the model's recomputation —
                    // the engine delivered every producer its correct upstream values.
                    expect(readContent(view.container)).toEqual(model.expectedValues());

                    // Initial resolution runs each producer exactly once: >=1 because its
                    // value rendered, <=1 because nothing was refreshed or changed.
                    const runCounts = harness.runCounts();
                    expect(runCounts.size).toBe(allKeys(spec).length);
                    for (const [key, count] of runCounts) {
                        expect(count, `producer runs for ${key}`).toBe(1);
                    }
                } finally {
                    view.unmount();
                    for (const entry of harness.ledger()) {
                        expect(entry.detaches, `attach/detach balance for ${entry.id}`).toBe(
                            entry.attaches,
                        );
                        expect(
                            entry.maxConcurrent,
                            `concurrent attaches for ${entry.id}`,
                        ).toBeLessThanOrEqual(1);
                    }
                }
            }),
            fuzz(25),
        );
    });
});
