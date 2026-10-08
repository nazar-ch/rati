import { expect } from 'vite-plus/test';

import { act } from '@testing-library/react';
import * as fc from 'fast-check';

import { byLevel } from './arbitraries.js';
import { assertLedgerBounds } from './ledger.js';
import { allKeys, type DeclaredState, type ReferenceModel, type ScopeSpec } from './model.js';
import { readContent, readSlot, type BuiltHarness } from './scopeHarness.js';

import { flush } from '../../testing/index.js';

/*
    long:2
    The command alphabet: the events an island meets, driven against the real thing and
    mirrored in model.ts. Every command asserts the contract after itself, so fast-check shrinks
    a violation to a minimal command sequence.

      - TARGETS ARE PICKED AT RUN TIME: a command's `pick` nat indexes the model's currently
        legal targets, since a key generated up front makes most commands inapplicable.
      - EVERY MUTATION RUNS INSIDE `act`, then one fixed flush: React delivers a Suspense retry a
        tick after the resolution (packages/rati/src/__tests__/suspense-situations.md). Never
        poll-until-green.

    The invariants: slot correctness, no-blank, convergence, identity stability, run-count upper
    bounds, `pending` agreement, and the lifecycle ledger's mid-run bounds (ledger.ts).
*/

export type Model = ReferenceModel;

/** Non-vacuity, accumulated across every run of the command property: rebuilds of a
 * `.provide()` value that `assertProvideRebuild` actually observed. A green provide
 * variant that never rebuilt the value asserted nothing about the rebuild pairing. */
export const observed = { provideRebuilds: 0 };

export type Real = {
    harness: BuiltHarness;
    declared: DeclaredState;
    container: HTMLElement;
    spec: ScopeSpec;
};

/** The invariants that must hold after EVERY command. */
async function assertContract(model: Model, real: Real, label: string): Promise<void> {
    await flush();
    const { harness, container } = real;

    // 1 — slot correctness. Also the no-blank invariant (2): the model never leaves a key
    // 'ready' during a selective refresh, so a loading flash mid-refresh fails right here.
    expect(readSlot(container), `${label}: slot`).toBe(model.slot());

    // The live frontier agrees exactly: one run early, late or missing shows up here first.
    // Coalescing changes how many runs a key had, never whether one is outstanding.
    expect(harness.held(), `${label}: live frontier`).toEqual(model.liveEntries());

    // Superseded runs only get a BOUND: the engine may coalesce two dirty marks into one
    // re-run, and the altitude rule keeps a lazier engine green.
    const staleBound = new Set(model.staleKeys());
    for (const key of harness.staleHeld()) {
        expect(staleBound.has(key), `${label}: unpredicted superseded run for ${key}`).toBe(true);
    }

    // 7 — `pending` agreement through `useScopeControls`, the error slot included: an erroring
    // swapped source leaves `pending`, and a promise re-fetch in flight when another key errored
    // the tree STAYS until it settles through the controller.
    expect(harness.pending(), `${label}: pending`).toEqual(model.pending());

    // 5 — run-count upper bounds: one run per generation, per direct refresh, and per time
    // a read changed. Never an exact count: an engine that coalesces two dirty marks into
    // one re-run is LAZIER, which the altitude rule says must stay green.
    for (const keySpec of allKeys(real.spec)) {
        const runs = harness.runCounts().get(keySpec.key) ?? 0;
        expect(runs, `${label}: run bound for ${keySpec.key}`).toBeLessThanOrEqual(
            model.runBudgetOf(keySpec.key),
        );
    }

    // 6 — the lifecycle ledger's mid-run half (bounds only; balance is the property's
    // teardown). Runs on every command, since a double attach or a source left feeding a
    // render is a TRANSIENT state — by teardown the sweep has tidied it away.
    assertLedgerBounds(harness, model.slot(), label);
}

type Snapshot = { committedChanges: number; provideBuilds: number };

const snapshot = (model: Model, real: Real): Snapshot => ({
    committedChanges: model.stats.committedChanges,
    provideBuilds: real.harness.provideLog().length,
});

/**
 * The `.provide()` variant's pairing contract: a key the factory read changed, so the value
 * built over it disposed and rebuilt. Gated on the MODEL's committed-change counter, so a
 * re-fetch the equals gate swallowed, or a first settle, asks for nothing.
 */
function assertProvideRebuild(before: Snapshot, model: Model, real: Real, label: string): void {
    if (!real.harness.provideLog().length) return;
    if (model.stats.committedChanges === before.committedChanges) return;
    expect(
        real.harness.provideLog().length,
        `${label}: a changed value must rebuild the provided value`,
    ).toBeGreaterThan(before.provideBuilds);
    observed.provideRebuilds++;
}

/**
 * Indexes into a runtime-computed target list. `toString` reports the GENERATED pick:
 * fast-check clones commands between runs, so a key stashed on `this` can print the wrong one.
 * The resolved key rides every assertion message.
 */
abstract class PickCommand implements fc.AsyncCommand<Model, Real> {
    constructor(private readonly pick: number) {}

    protected abstract targets(model: Model): string[];
    protected abstract exec(model: Model, real: Real, key: string): Promise<void>;
    protected abstract get verb(): string;

    check(model: Model): boolean {
        return this.targets(model).length > 0;
    }

    async run(model: Model, real: Real): Promise<void> {
        const targets = this.targets(model);
        const key = targets[this.pick % targets.length]!;
        const before = snapshot(model, real);
        await this.exec(model, real, key);
        // After `exec`, so it reads a flushed tree (`assertContract` closes every exec).
        assertProvideRebuild(before, model, real, `${this.verb}(${key})`);
    }

    toString(): string {
        return `${this.verb}#${this.pick}`;
    }
}

/** Resolve a held first load, or an in-flight re-fetch. */
class Settle extends PickCommand {
    protected get verb() {
        return 'settle';
    }
    protected targets(model: Model) {
        return model.settleable();
    }
    protected async exec(model: Model, real: Real, key: string) {
        const wasRefetch = model.pending().includes(key);
        const changes = model.willChange(key);
        const identityBefore = real.harness.identityOf(key);

        model.settle(key);
        await act(async () => {
            real.harness.settle(key);
        });
        await assertContract(model, real, `settle(${key})`);

        // 4 — identity stability: a re-fetch the equals gate rejects keeps the REFERENCE
        // the component already had, not just an equal value. Only asserted in the direction
        // the contract promises (an unchanged settle); a changed one is covered by value.
        if (wasRefetch && !changes) {
            expect(
                real.harness.identityOf(key),
                `settle(${key}): an equal re-fetch keeps the rendered identity`,
            ).toBe(identityBefore);
        }
    }
}

/** Fail a held first load (-> the error slot) or an in-flight re-fetch (-> keep the value). */
class Reject extends PickCommand {
    protected get verb() {
        return 'reject';
    }
    protected targets(model: Model) {
        return model.rejectable();
    }
    protected async exec(model: Model, real: Real, key: string) {
        const wasRefetch = model.pending().includes(key);
        const contentBefore = readContent(real.container);

        model.reject(key);
        await act(async () => {
            real.harness.reject(key);
        });
        await assertContract(model, real, `reject(${key})`);

        // A failed PROMISE RE-FETCH keeps the previous value and only logs — the island
        // must not fall over because a refresh failed.
        if (wasRefetch && model.slot() === 'content') {
            expect(
                readContent(real.container),
                `reject(${key}): a failed re-fetch keeps the previous value`,
            ).toEqual(contentBefore);
        }
    }
}

/**
 * Fires a superseded producer run, the refresh token guard's tripwire. Targets come from the
 * HARNESS, since the model only bounds superseded runs. A key ALSO in flight is preferred —
 * the guard's own case, a later refresh of the same key — over a remount's leftovers.
 */
class SettleStale implements fc.AsyncCommand<Model, Real> {
    constructor(private readonly pick: number) {}

    check(model: Model): boolean {
        return model.staleKeys().length > 0;
    }

    async run(model: Model, real: Real): Promise<void> {
        const available = real.harness.staleHeld();
        // The engine coalesced the re-runs the model bounded — nothing to fire.
        if (!available.length) return;
        const inFlight = new Set(model.pending());
        const superseded = available.filter((key) => inFlight.has(key));
        const targets = superseded.length ? superseded : available;
        await this.exec(model, real, targets[this.pick % targets.length]!);
    }

    toString(): string {
        return `settleStale#${this.pick}`;
    }

    private async exec(model: Model, real: Real, key: string) {
        const slotBefore = readSlot(real.container);
        const contentBefore = readContent(real.container);
        const pendingBefore = real.harness.pending();
        const runsBefore = real.harness.totalRuns();
        const buildsBefore = real.harness.provideLog().length;

        model.dropStale(key);
        await act(async () => {
            real.harness.settleStale(key);
        });
        await flush();

        // Inert, in every observable: a run whose cell was replaced (a superseded refresh)
        // or torn down (a remount) must reach nothing at all.
        expect(readSlot(real.container), `settleStale(${key}): slot unmoved`).toBe(slotBefore);
        expect(readContent(real.container), `settleStale(${key}): values unmoved`).toEqual(
            contentBefore,
        );
        expect(real.harness.pending(), `settleStale(${key}): pending unmoved`).toEqual(
            pendingBefore,
        );
        expect(real.harness.totalRuns(), `settleStale(${key}): no producer ran`).toBe(runsBefore);
        // Nothing committed, so the `.provide()` value has no reason to rebuild either —
        // the inertness claim reaching one level further out than the rendered values.
        expect(
            real.harness.provideLog().length,
            `settleStale(${key}): the provided value was not rebuilt`,
        ).toBe(buildsBefore);
        await assertContract(model, real, `settleStale(${key})`);
    }
}

/** A committed live source drops back to pending (S8) — the levels below unmount. */
class SourcePend extends PickCommand {
    protected get verb() {
        return 'sourcePend';
    }
    protected targets(model: Model) {
        return model.liveSources();
    }
    protected async exec(model: Model, real: Real, key: string) {
        const runsBefore = real.harness.totalRuns();
        model.sourcePend(key);
        await act(async () => {
            real.harness.sourcePend(key);
        });
        await assertContract(model, real, `sourcePend(${key})`);
        // The levels below unmount, but their data cells stay cached on the mandala.
        expect(real.harness.totalRuns(), `sourcePend(${key}): no producer re-ran`).toBe(runsBefore);
    }
}

/** A repending source recovers (S8) — cached cells render again, no producer re-runs. */
class SourceRestore extends PickCommand {
    protected get verb() {
        return 'sourceRestore';
    }
    protected targets(model: Model) {
        return model.repending();
    }
    protected async exec(model: Model, real: Real, key: string) {
        const runsBefore = real.harness.totalRuns();
        model.sourceRestore(key);
        await act(async () => {
            real.harness.sourceRestore(key);
        });
        await assertContract(model, real, `sourceRestore(${key})`);
        // Recovery without producer re-runs.
        expect(real.harness.totalRuns(), `sourceRestore(${key}): no producer re-ran`).toBe(
            runsBefore,
        );
    }
}

/** A committed live source errors — it throws to the boundary, so the error slot. */
class SourceError extends PickCommand {
    protected get verb() {
        return 'sourceError';
    }
    protected targets(model: Model) {
        return model.liveSources();
    }
    protected async exec(model: Model, real: Real, key: string) {
        model.sourceError(key);
        await act(async () => {
            real.harness.sourceError(key);
        });
        await assertContract(model, real, `sourceError(${key})`);
    }
}

/** A committed live source emits a new value by itself — no producer re-run, no refresh. */
class SourceBump extends PickCommand {
    protected get verb() {
        return 'sourceBump';
    }
    protected targets(model: Model) {
        return model.liveSources();
    }
    protected async exec(model: Model, real: Real, key: string) {
        // The model bumps the epoch; the harness only emits at it.
        model.sourceBump(key);
        await act(async () => {
            real.harness.sourceEmit(key);
        });
        await assertContract(model, real, `sourceBump(${key})`);
        // A source is a cascade ORIGIN, not just a target: its new value must reach the
        // loads that read it, and it must do so without ever dropping the content.
        expect(readSlot(real.container), `sourceBump(${key}): content stays up`).toBe('content');
    }
}

/** `refresh(key)` through `useScopeControls`. */
class Refresh extends PickCommand {
    protected get verb() {
        return 'refresh';
    }
    protected targets(model: Model): string[] {
        return model.refreshable();
    }
    protected async exec(model: Model, real: Real, key: string) {
        model.refresh(key);
        await act(async () => {
            real.harness.refresh(key);
        });
        await assertContract(model, real, `refresh(${key})`);

        // 2 — the no-blank promise: a selective refresh never drops the content on screen, the
        // tripwire for a defeated stale-while-refetch.
        expect(readSlot(real.container), `refresh(${key}): content stays up`).toBe('content');
    }
}

/** `refresh()` with no key — the whole scope re-resolves through the loading slot. */
class RefreshAll implements fc.AsyncCommand<Model, Real> {
    check(): boolean {
        return true;
    }
    async run(model: Model, real: Real): Promise<void> {
        // The remount drops every cell, so whatever was in flight is superseded — mark it
        // before the act, since the re-running producers push fresh entries inside it.
        real.harness.supersedeAll();
        model.newGeneration();
        await act(async () => {
            real.harness.refreshAll();
        });
        await assertContract(model, real, 'refreshAll');
    }
    toString(): string {
        return 'refreshAll';
    }
}

/** Change the island's input — remount semantics, and the new input reaches every reader. */
class ChangeInput implements fc.AsyncCommand<Model, Real> {
    check(): boolean {
        return true;
    }
    async run(model: Model, real: Real): Promise<void> {
        real.harness.supersedeAll();
        await act(async () => {
            real.declared.setInput();
        });
        // After the input moves, so the model's fixpoint recomputes against the new value.
        model.newGeneration();
        await assertContract(model, real, 'changeInput');
    }
    toString(): string {
        return 'changeInput';
    }
}

/**
 * Refreshes a key whose re-fetch is ALREADY in flight — the superseded-refresh race the token
 * guard exists for, where the older settle is discarded. A command of its own, since two plain
 * `refresh` commands reach it only when both pick one key by chance.
 */
class RefreshInFlight extends Refresh {
    protected override get verb() {
        return 'refreshInFlight';
    }
    protected override targets(model: Model) {
        const inFlight = new Set(model.pending());
        return model.refreshable().filter((key) => inFlight.has(key));
    }
}

/**
 * The alphabet. Weighted by hand: settles and refreshes are the machinery under test, while
 * the remount verbs reset everything — a uniform mix would spend most sequences re-resolving
 * from scratch and rarely reach a deep interleaving.
 */
export const commandsArb = (): fc.Arbitrary<Iterable<fc.AsyncCommand<Model, Real>>> =>
    fc.commands(
        [
            fc.nat().map((pick) => new Settle(pick)),
            fc.nat().map((pick) => new Settle(pick)),
            fc.nat().map((pick) => new Settle(pick)),
            fc.nat().map((pick) => new Refresh(pick)),
            fc.nat().map((pick) => new Refresh(pick)),
            fc.nat().map((pick) => new RefreshInFlight(pick)),
            fc.nat().map((pick) => new RefreshInFlight(pick)),
            fc.nat().map((pick) => new Reject(pick)),
            fc.nat().map((pick) => new SettleStale(pick)),
            fc.nat().map((pick) => new SourcePend(pick)),
            fc.nat().map((pick) => new SourceRestore(pick)),
            fc.nat().map((pick) => new SourceError(pick)),
            fc.nat().map((pick) => new SourceBump(pick)),
            fc.nat().map((pick) => new SourceBump(pick)),
            fc.constant(new RefreshAll()),
            fc.constant(new ChangeInput()),
        ],
        { maxCommands: byLevel(8, 4), size: 'large' },
    );
