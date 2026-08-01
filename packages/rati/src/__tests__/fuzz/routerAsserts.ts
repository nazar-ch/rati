import { expect, vi } from 'vite-plus/test';
import type { RouterModel, Step } from './routerModel';
import type { Harness } from './routerHarness';

/*
    The invariants both router fuzz properties check, in one place: the smoke property
    (RF-02) drives them over forward navigation, the command property (RF-03) over
    traversal interleavings, and neither may hold the router to a different bar than the
    other.

    Every assert here sits at the contract altitude (docs/planned/router-fuzz/README.md
    §"Decisions taken"): the rendered route, `history.location`, the public getters, remount
    discipline through mount effects, the redirect trail. Never `pathCounter`, the skip
    marker's spelling, or a listener count.
*/

/**
 * The store logs on one path this suite walks on purpose — the redirect loop it refused to
 * follow — and reaching that is a *pass*. Sorted from everything else rather than silenced:
 * a React warning about the harness is a finding, and a blanket no-op would eat it.
 */
export type ErrorLog = {
    /** `redirect loop` reports since the last `reset()`. */
    loops: string[];
    /** Anything else the run logged as an error — always a failure, never noise. */
    unexpected: string[];
    reset(): void;
};

/** Install the console.error sorter. Call from `beforeEach`; `vi.restoreAllMocks()` undoes it. */
export function installErrorLog(): ErrorLog {
    const log: ErrorLog = {
        loops: [],
        unexpected: [],
        reset() {
            log.loops = [];
            log.unexpected = [];
        },
    };
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
        const first = typeof args[0] === 'string' ? args[0] : String(args[0]);
        if (first.includes('redirect loop')) log.loops.push(first);
        else log.unexpected.push(first);
    });
    return log;
}

/**
 * The whole observable surface, checked against one model Step.
 *
 * `rendered` arrives as `{ oneOf }` only when a redirect cycle hit the depth guard: which
 * of the cycle's routes is left on screen follows from the cap's parity, and that is not
 * something the router promises (the deterministic pin makes the same call — see
 * `redirect.test.tsx`). What *is* promised, and asserted: following stops, one of the
 * cycle's routes renders, the loop is reported — and the trail is still exact.
 */
export function assertStep(harness: Harness, step: Step, label: string, log: ErrorLog) {
    assertRenderedState(harness, step, label);

    // Following stopped exactly where the model says the guard stopped it — and nowhere
    // else. The negative half is the sharper one: an over-eager guard that gave up on an
    // honest redirect chain would report a loop that isn't there.
    if (step.reportedLoop) {
        expect(log.loops, `${label}: the refused loop must be reported`).not.toHaveLength(0);
    } else {
        expect(log.loops, `${label}: no loop to report`).toHaveLength(0);
    }
    // Nothing else may have gone to console.error — a React warning here would mean the
    // harness is driving the router in a way an app never would.
    expect(log.unexpected, `${label}: unexpected console.error`).toEqual([]);
}

/**
 * Everything the router is *showing*, as opposed to what the last command *did*.
 *
 * The split is load-bearing for the properties' closing catch-all, which restates the end
 * state after the last command rather than judging a command of its own: `reportedLoop` is
 * scoped to the resolution that raised it (`Step`), and a command that resolved nothing —
 * a traversal with nowhere to go — leaves the model still describing the last one that did
 * while the console log has moved on. Asserting a command-scoped fact out of a state
 * restatement fails on that disagreement rather than on anything the router got wrong; the
 * fuzz run found it by shrinking to `[initial URL is the cycle, go(0)]`.
 */
export function assertRenderedState(harness: Harness, step: Step, label: string) {
    const rendered = harness.rendered();

    if (step.rendered === null) {
        expect(rendered, `${label}: nothing should be rendered`).toBeNull();
    } else if ('oneOf' in step.rendered) {
        expect(step.rendered.oneOf, `${label}: a cycle must leave one of its own routes`).toContain(
            rendered?.name,
        );
    } else {
        // The headline: the route on screen, and the params its component was handed.
        expect(rendered, `${label}: rendered route`).toEqual(step.rendered);
    }

    // The URL bar, and the router's reading of it.
    const location = harness.router.history.location;
    expect(location.pathname + location.search + location.hash, `${label}: url`).toBe(step.url);
    expect(harness.router.path, `${label}: router.path`).toBe(step.path);
    expect(harness.router.search, `${label}: router.search`).toBe(step.search);
    expect(harness.router.hash, `${label}: router.hash`).toBe(step.hash);
    assertState(harness, step, label);

    // The trail prepareRoute reports a 30x from.
    expect(harness.router.redirectHops, `${label}: redirectHops`).toEqual(step.hops);
}

/**
 * `router.state` — the per-entry state, which the getter documents as "user state attached
 * to the current history entry via `navigate`/`replace` `{ state }`, or `null`".
 *
 * On an entry a *shallow* navigation created, it is not only that: the store keeps its
 * suppression marker inside the same object, so the getter hands the app an internal
 * `skip` key alongside its own. That is a filed finding (README, 2026-07-16 (RF-03)), not
 * a shape the model blesses — so the marker is allowed through here by name, and only
 * where the model says a stamp exists, while the user's own half is still held to equality.
 * The day the marker moves out of user state, the `stateHasMark` branch goes red and says
 * so, which is the point of asserting its presence rather than ignoring extra keys.
 */
function assertState(harness: Harness, step: Step, label: string) {
    const state = harness.router.state;
    if (!step.stateHasMark) {
        expect(state, `${label}: router.state`).toEqual(step.state);
        return;
    }
    const { skip, ...user } = state as Record<string, unknown>;
    expect(typeof skip, `${label}: the shallow entry's marker rides in router.state`).toBe(
        'string',
    );
    expect(user, `${label}: router.state (the caller's own half)`).toEqual(step.state ?? {});
}

/** Remount discipline: the ledger grew by exactly the mounts the model predicted, and its
 * newest entry is what is on screen. Mounts are observed through the probes' mount effects
 * — a render counter would fail the moment React legitimately re-rendered. */
export function assertMounts(harness: Harness, model: RouterModel, step: Step, label: string) {
    expect(harness.mounts.length, `${label}: mount count`).toBe(model.mountCount());
    if (step.rendered !== null && !('oneOf' in step.rendered)) {
        // A skipped navigation leaves the previous mount newest, so this also says "the
        // route still mounted is the right one".
        expect(harness.mounts[harness.mounts.length - 1], `${label}: newest mount`).toEqual(
            step.rendered,
        );
    }
}
