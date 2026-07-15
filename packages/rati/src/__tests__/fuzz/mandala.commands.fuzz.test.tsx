import * as fc from 'fast-check';
import { describe, test, expect, afterEach, beforeEach, vi } from 'vite-plus/test';
import { render, cleanup, act } from '@testing-library/react';
import { fuzz } from './arbitraries';
import { assertLedgerBalanced } from './ledger';
import { createDeclaredState, createModel } from './model';
import { buildHarness, readContent, readSlot, scopeSpecArb } from './scopeHarness';
import { commandsArb, observed, type Model, type Real } from './commands';

/*
    The MF-02 model-based property: a generated scope meets a generated *event sequence* —
    settles, rejections, superseded settles, source transitions, selective refreshes, full
    re-resolves, input changes — driven against a real island and mirrored in the reference
    model. Each command asserts the contract after itself (commands.ts); this file owns the
    two things only the whole run can say: the quiesce tail's **convergence** check, and the
    teardown ledger.

    A generated fraction of runs deliberately ends mid-flight (`skipQuiesce`) and unmounts
    with loads still in the air — situation S5 of `../suspense-situations.md`: the late
    settles must be inert and the ledger must still balance, with never-attached sources at
    0/0.

    Another generated fraction (`withProvide`) ends the scope in `.provide()`, so the same
    alphabet runs against an island that also owns a derived, disposable value. That variant
    is what carries the `.provide()` half of the lifecycle contract: dispose-before-detach
    and the dispose/rebuild pairing across refresh-driven rebuilds (ledger.ts + the
    `assertProvideRebuild` in commands.ts).

    Budget: fuzz(25) x byLevel(8, 4) commands keeps the default `vp run rati#test` in
    seconds. Deep runs are manual — `FUZZ_RUNS=500 vp run rati#test src/__tests__/fuzz/`.
*/

// Non-vacuity, accumulated across the whole run set: a green property that never actually
// refreshed anything with a changed payload is a harness failure, not a pass. Counted here
// rather than forced per-sequence (the record allows either): a per-case `fc.pre` would
// discard the majority of sequences — most of a random alphabet never reaches a refresh —
// and spend the budget generating cases instead of searching them.
const exercised = { refreshWithChange: 0, cascades: 0, supersededRuns: 0, sourceValueChanges: 0 };

beforeEach(() => {
    // The contract logs on the paths this alphabet walks on purpose: a failed re-fetch
    // (`console.error`, keeping the previous value) and an ignored refresh of a source
    // (`console.warn`). Silenced so a green run stays readable.
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

/**
 * Drive the initial resolution to content before the commands start.
 *
 * Half the runs take this (a generated boolean), because the two starts search different
 * things and a cold start alone barely reaches the interesting half: `refresh` needs content
 * showing, fast-check biases toward short command lists, and a multi-level scope can burn a
 * whole 8-command budget just settling its initial loads — the first version of this property
 * tripped its own non-vacuity guard with *zero* refreshes across 25 runs. Warm runs land in
 * the refresh/cascade/source-transition machinery immediately; cold runs keep the paths only
 * an unresolved island has (rejecting an initial load into the error slot, unmounting
 * mid-flight).
 */
async function warmUp(model: Model, real: Real): Promise<void> {
    let guard = 0;
    while (model.liveEntries().length) {
        if (guard++ > 500) throw new Error('warmUp: the model never settled');
        const key = model.liveEntries()[0]!;
        model.settle(key);
        await act(async () => {
            real.harness.settle(key);
        });
        await act(async () => {});
    }
    expect(model.slot(), 'warmUp: expected a resolved island').toBe('content');
}

/** Settle everything outstanding, then assert the run converged. */
async function quiesce(model: Model, real: Real): Promise<void> {
    // Nothing converges from the error slot — recover through the retry path first, which
    // is the same full re-resolve the error slot's `retry` verb gives an app.
    if (model.slot() === 'error') {
        real.harness.supersedeAll();
        model.newGeneration();
        await act(async () => {
            real.harness.refreshAll();
        });
        await act(async () => {});
    }
    // `repending()` already returns a fresh array, so restoring as we go is safe.
    for (const key of model.repending()) {
        model.sourceRestore(key);
        await act(async () => {
            real.harness.sourceRestore(key);
        });
    }
    let guard = 0;
    while (model.liveEntries().length) {
        // A settle can cascade into fresh in-flight work, so this drains rather than loops
        // over a snapshot; the bound is a bug-catcher, not an expected exit.
        if (guard++ > 500) throw new Error('quiesce: the model never settled');
        const key = model.liveEntries()[0]!;
        model.settle(key);
        await act(async () => {
            real.harness.settle(key);
        });
        await act(async () => {});
    }
    await act(async () => {});

    expect(model.slot(), 'quiesce: the model itself must reach content').toBe('content');
    expect(readSlot(real.container), 'quiesce: slot').toBe('content');

    // 3 — convergence. Every rendered value equals a from-scratch resolution of the current
    // declared state (the model's fixpoint). This is the soundness property: lost cascades,
    // stale dependents, superseded settles that applied anyway, and wrong-order settles all
    // land here.
    expect(readContent(real.container), 'quiesce: convergence').toEqual(model.expectedValues());
    expect(real.harness.pending(), 'quiesce: nothing left in flight').toEqual([]);
}

describe('mandala fuzz — commands (event interleavings over generated scopes)', () => {
    test('a generated scope survives any event sequence and converges', async () => {
        await fc.assert(
            fc.asyncProperty(
                // A real waterfall: cascades are what this property searches for.
                scopeSpecArb({ minLevels: 2 }),
                commandsArb(),
                fc.boolean(),
                fc.boolean(),
                fc.boolean(),
                async (spec, cmds, warmStart, skipQuiesce, withProvide) => {
                    const declared = createDeclaredState();
                    const harness = buildHarness(spec, declared, { provide: withProvide });
                    const model = createModel(spec, declared);
                    // Async act at the mount — see suspense-situations.md S2.
                    let view!: ReturnType<typeof render>;
                    await act(async () => {
                        view = render(<harness.Host />);
                    });
                    const real: Real = {
                        harness,
                        declared,
                        container: view.container,
                        spec,
                    };
                    try {
                        if (warmStart) await warmUp(model, real);
                        await fc.asyncModelRun(() => ({ model, real }), cmds);
                        if (!skipQuiesce) await quiesce(model, real);
                    } finally {
                        exercised.refreshWithChange += model.stats.refreshWithChange;
                        exercised.cascades += model.stats.cascades;
                        exercised.supersededRuns += model.stats.supersededRuns;
                        exercised.sourceValueChanges += model.stats.sourceValueChanges;

                        view.unmount();
                        // S5 — late settles into a discarded tree: no throw, no state write,
                        // no log. `skipQuiesce` runs make this the common case.
                        await act(async () => {
                            let remaining = harness.held();
                            while (remaining.length) {
                                harness.settle(remaining[0]!);
                                remaining = harness.held();
                            }
                        });

                        // 6 — the lifecycle ledger at final unmount: every attach matched
                        // by a detach, every `.provide()` value disposed (and disposed
                        // while its sources were still attached). A leak fails the run
                        // even though every mid-run assert passed.
                        assertLedgerBalanced(harness, 'teardown');
                    }
                },
            ),
            fuzz(100),
        );

        // The harness must have actually reached the machinery it claims to cover.
        expect(exercised.refreshWithChange, 'no refresh ever changed a value').toBeGreaterThan(0);
        expect(exercised.cascades, 'no cascade ever fired').toBeGreaterThan(0);
        expect(exercised.supersededRuns, 'no producer run was ever superseded').toBeGreaterThan(0);
        expect(exercised.sourceValueChanges, 'no live source ever moved').toBeGreaterThan(0);
        expect(observed.provideRebuilds, 'no .provide() value ever rebuilt').toBeGreaterThan(0);
    });
});
