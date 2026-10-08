import { expect, vi } from 'vite-plus/test';

import type { Harness } from './routerHarness.js';
import type { RouterModel, Step } from './routerModel.js';

/*
    The invariants both router fuzz properties check, smoke and command alike. Every assert
    reads the contract — the rendered route, `history.location`, the public getters, mount
    effects, the redirect trail — never `pathCounter` or a listener count.
*/

/**
 * The store logs on one path this suite walks on purpose — the redirect loop it refused to
 * follow — and reaching that is a PASS. Sorted from everything else rather than silenced:
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
 * The whole observable surface against one model Step. `rendered` is `{ oneOf }` only for a
 * capped redirect cycle, whose surviving route the router never promises; what IS asserted:
 * following stops, one of the cycle's routes renders, the loop is reported, the trail is exact.
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
 * What the router is SHOWING, as opposed to what the last command DID: the properties' closing
 * catch-all restates the end state, and `reportedLoop` belongs to the resolution that raised it,
 * so a command resolving nothing leaves the model describing an earlier one.
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
 * `router.state`, the per-entry user state. On an entry a SHALLOW navigation created, the
 * getter also hands over the store's internal `skip` marker, allowed by name only where the
 * model says a stamp exists; the `stateHasMark` branch goes red when the marker leaves it.
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
