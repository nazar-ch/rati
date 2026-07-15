import * as fc from 'fast-check';
import { StrictMode } from 'react';
import { describe, test, expect, afterEach } from 'vite-plus/test';
import { render, cleanup, act } from '@testing-library/react';
import { fuzz } from './arbitraries';
import { assertLedgerBalanced, assertLedgerBounds } from './ledger';
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

    MF-03 runs the same property a second time under `<StrictMode>` (see `runCountBound`): the
    contract must not depend on React's dev double-mount, and the ledger must balance through
    the mount → cleanup → mount sequence — the one place a source can be attached by a run
    whose cells were already thrown away.
*/

afterEach(cleanup);

/** This property's settle policy: lowest `settleOrder` first, ties by key. The command
 * suite picks its own order, so the policy lives here rather than in the model. */
function nextToSettle(spec: ScopeSpec, held: string[]): string {
    const order = new Map(allKeys(spec).map((keySpec) => [keySpec.key, keySpec.settleOrder]));
    return [...held].sort((a, b) => order.get(a)! - order.get(b)! || (a < b ? -1 : 1))[0]!;
}

/*
    Producer runs per key, as generations rather than a raw count (the altitude rule's
    wording for run counts). Plain: one generation, so exactly one run each. StrictMode: the
    dev double-mount drops the mandala's cell cache and rebuilds it, which is a second
    generation for every level the mount reached — so the level-0 producers run twice, and a
    level only the settles reach still runs once. Hence a *range*, not an equality: which
    levels the double-mount got to depends on the generated shape (a scope of plain values
    resolves the whole waterfall before the first settle), and that is not the contract's
    business.
*/
const runCountBound = (strict: boolean) => (strict ? { min: 1, max: 2 } : { min: 1, max: 1 });

function smokeProperty(strict: boolean) {
    const bound = runCountBound(strict);

    return fc.asyncProperty(scopeSpecArb(), async (spec) => {
        const declared = createDeclaredState();
        const harness = buildHarness(spec, declared);
        const model = createModel(spec, declared);
        // Mount inside an *async* act: under the sync act RTL wraps render() in,
        // React never delivers the Suspense retry for a promise resolved later —
        // the island stays on the loading slot forever (found by this property's
        // first run; the deterministic suites mount this way throughout).
        let view!: ReturnType<typeof render>;
        await act(async () => {
            // `<StrictMode>` has to be the *root* element `render` gets: nested one
            // component deeper React still double-renders but skips the double-mount
            // (no cleanup/re-run of effects) — which would leave this variant asserting
            // nothing about the lifecycle it exists for.
            const tree = <harness.Host />;
            view = render(strict ? <StrictMode>{tree}</StrictMode> : tree);
        });
        try {
            for (;;) {
                // Slot correctness: content if and only if every key is ready
                // (all-or-nothing resolution), the loading slot otherwise.
                expect(readSlot(view.container)).toBe(model.slot());

                // The held frontiers agree: exactly the model-predicted loads are
                // in flight (a producer running early or late shows up here). Under
                // StrictMode the first generation's loads are held too, but its
                // producers superseded them on the rebuild — so the *live* frontier
                // is one entry per key either way.
                expect(harness.held()).toEqual(model.held());

                assertLedgerBounds(harness, model.slot(), 'smoke');

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

            // Initial resolution runs each producer once per generation: >= min because
            // its value rendered, <= max because nothing was refreshed or changed.
            const runCounts = harness.runCounts();
            expect(runCounts.size).toBe(allKeys(spec).length);
            for (const [key, count] of runCounts) {
                expect(count, `producer runs for ${key}`).toBeGreaterThanOrEqual(bound.min);
                expect(count, `producer runs for ${key}`).toBeLessThanOrEqual(bound.max);
            }
        } finally {
            view.unmount();
            assertLedgerBalanced(harness, 'teardown');
        }
    });
}

describe('mandala fuzz — smoke (initial resolution over generated scopes)', () => {
    test('a generated scope resolves to convergence, in any settle order', async () => {
        await fc.assert(smokeProperty(false), fuzz(25));
    });

    test('the same holds under StrictMode, and the ledger balances through the double-mount', async () => {
        await fc.assert(smokeProperty(true), fuzz(25));
    });
});
