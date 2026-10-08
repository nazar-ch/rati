import { describe, test, expect, afterEach } from 'vite-plus/test';

import { StrictMode } from 'react';

import { render, cleanup, act } from '@testing-library/react';
import * as fc from 'fast-check';

import { fuzz, fuzzTimeout } from './arbitraries.js';
import { assertLedgerBalanced, assertLedgerBounds } from './ledger.js';
import { allKeys, createDeclaredState, createModel, type ScopeSpec } from './model.js';
import { buildHarness, readContent, readSlot, scopeSpecArb } from './scopeHarness.js';

/*
    long:2
    The smoke property: a generated scope mounts, its held loads settle one by one in a
    generated order, and at every step the island shows what the model says — the loading slot
    until the last key, then content carrying the model's values. Teardown balance is asserted
    in a `finally`, so a leak fails the run even when every mid-run assert passed. Initial
    resolution only; the event alphabet is the command property's.

    The property runs again under `<StrictMode>`: the contract must not depend on React's dev
    double-mount, and the ledger balances through mount → cleanup → mount.
*/

afterEach(cleanup);

/** This property's settle policy: lowest `settleOrder` first, ties by key. The command
 * suite picks its own order, so the policy lives here rather than in the model. */
function nextToSettle(spec: ScopeSpec, held: string[]): string {
    const order = new Map(allKeys(spec).map((keySpec) => [keySpec.key, keySpec.settleOrder]));
    return [...held].sort((a, b) => order.get(a)! - order.get(b)! || (a < b ? -1 : 1))[0]!;
}

/*
    Producer runs per key, as generations. Plain: one run each. StrictMode's double-mount
    rebuilds the cell cache, a second generation for every level the mount reached — so a
    RANGE, since which levels it reached depends on the generated shape.
*/
const runCountBound = (strict: boolean) => (strict ? { min: 1, max: 2 } : { min: 1, max: 1 });

function smokeProperty(strict: boolean) {
    const bound = runCountBound(strict);

    return fc.asyncProperty(scopeSpecArb(), async (spec) => {
        const declared = createDeclaredState();
        const harness = buildHarness(spec, declared);
        const model = createModel(spec, declared);
        // Mount inside an ASYNC act: under a sync act React never delivers the Suspense
        // retry for a promise resolved later, and the island stays loading.
        let view!: ReturnType<typeof render>;
        await act(async () => {
            // `<StrictMode>` has to be the ROOT element `render` gets: nested one
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

                // The held frontiers agree: exactly the predicted loads are in flight.
                // StrictMode's first-generation loads are superseded on the rebuild, so
                // the LIVE frontier is one entry per key either way.
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
    test(
        'a generated scope resolves to convergence, in any settle order',
        async () => {
            await fc.assert(smokeProperty(false), fuzz(25));
        },
        fuzzTimeout(),
    );

    test(
        'the same holds under StrictMode, and the ledger balances through the double-mount',
        async () => {
            await fc.assert(smokeProperty(true), fuzz(25));
        },
        fuzzTimeout(),
    );
});
