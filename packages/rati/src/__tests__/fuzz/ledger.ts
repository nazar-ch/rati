import { expect } from 'vite-plus/test';
import type { Slot } from './model';
import type { BuiltHarness } from './scopeHarness';

/*
    MF-03 — invariant 6 of docs/archive/mandala-testing.md §"Invariants": the lifecycle
    ledger, read off the harness's per-source-instance attach/detach counters and its
    `.provide()` value's build/dispose record. The machinery under it is the refresh work's
    source-lifetime rework (a cascade swaps a source mid-flight, a Step's teardown keeps
    entries the live bucket still holds, the mandala's unmount sweep is the backstop) —
    exactly the class a ledger catches and example tests miss.

    Two altitudes, deliberately:

      - `assertLedgerBounds` after every command: *bounds only*. No instance attached twice
        at once, nothing detached still feeding the render, no provided value disposed after
        the sources it was built over. It never asserts churn-freedom — when a mid-tree
        source drops to pending the levels below unmount, and whether their sources ride
        that window out attached is the engine's choice, not a promise
        (../suspense-situations.md S8).
      - `assertLedgerBalanced` at final unmount: every attach matched by a detach, every
        provided value disposed. A leak fails the run even when every mid-run assert passed,
        and a never-attached source (its level never committed — the S5 unmount-while-
        suspended runs) sits at 0/0, which is balanced.
*/

/** Disposes recorded so far — a `null` violation list still means "disposed". */
const disposed = (record: { detachedAtDispose: readonly string[] | null }) =>
    record.detachedAtDispose !== null;

function assertProvideBounds(harness: BuiltHarness, label: string): void {
    for (const record of harness.provideLog()) {
        // The dispose-before-detach contract: `.provide()` promises the value is torn down
        // while the sources it was built over are still attached, so a value holding a
        // grabbed resource never outlives its grab. The list is what the dispose *saw*.
        expect(
            record.detachedAtDispose ?? [],
            `${label}: ${record.id} disposed after its sources detached`,
        ).toEqual([]);
    }
    // Build/dispose pairing: the old value is disposed before its replacement is built, so
    // two provided values are never live at once (a leaked one would keep its subscriptions).
    const live = harness.provideLog().filter((record) => !disposed(record));
    expect(
        live.length,
        `${label}: provided values live at once — ${live.map((record) => record.id).join(', ')}`,
    ).toBeLessThanOrEqual(1);
}

/** The bounds that must hold at every rest point — after every command. */
export function assertLedgerBounds(harness: BuiltHarness, slot: Slot, label: string): void {
    for (const entry of harness.ledger()) {
        expect(
            entry.maxConcurrent,
            `${label}: ${entry.id} was attached twice at once`,
        ).toBeLessThanOrEqual(1);
    }
    // Nothing detached still feeds renders: while content is up, every source instance a
    // cell currently holds is one the island is subscribed to. Its transitions are what the
    // rendered value tracks, so a detached one would render data nobody is maintaining.
    if (slot === 'content') {
        for (const entry of harness.ledger()) {
            if (!entry.current) continue;
            expect(
                entry.attached,
                `${label}: ${entry.id} feeds the rendered content while detached`,
            ).toBe(true);
        }
    }
    assertProvideBounds(harness, label);
}

/** Final unmount: everything the run attached is released, everything it built is disposed. */
export function assertLedgerBalanced(harness: BuiltHarness, label: string): void {
    for (const entry of harness.ledger()) {
        expect(entry.detaches, `${label}: attach/detach balance for ${entry.id}`).toBe(
            entry.attaches,
        );
        expect(
            entry.maxConcurrent,
            `${label}: ${entry.id} was attached twice at once`,
        ).toBeLessThanOrEqual(1);
    }
    for (const record of harness.provideLog()) {
        expect(disposed(record), `${label}: ${record.id} was never disposed`).toBe(true);
    }
    assertProvideBounds(harness, label);
}
