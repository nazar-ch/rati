import * as fc from 'fast-check';
import { describe, test, expect, afterEach, beforeEach, vi } from 'vite-plus/test';
import { cleanup, act } from '@testing-library/react';
import { fuzz } from './arbitraries';
import { RouterModel, type Step } from './routerModel';
import {
    applyNav,
    buildHarness,
    routerCaseArb,
    urlFor,
    type Harness,
    type Nav,
} from './routerHarness';

/*
    The RF-02 smoke property: a generated route table mounts, a generated sequence of
    navigate/replace calls runs against it, and at every step the Router shows exactly what
    the reference model says — the route (name + decoded params), the URL bar, the router's
    own path/search/hash/state, the redirect trail, and whether the route remounted.

    Traversal is not here: back/forward over the entry stack is RF-03's alphabet, and this
    property is the foundation it grows from (the model already keeps the stack). Route
    components are plain — data resolution under navigation is the mandala suite's ground.

    Every assert sits at the contract altitude (docs/planned/router-fuzz/README.md
    §"Decisions taken"): the rendered route, `history.location`, the public getters,
    remount discipline through mount effects. Never `pathCounter`, the skip marker, or a
    listener count.
*/

afterEach(cleanup);
afterEach(() => vi.restoreAllMocks());

/** The `redirect loop` reports the store made since the last check. */
let loopReports: string[] = [];
/** Anything else the run logged as an error — always a failure, never noise. */
let unexpectedErrors: string[] = [];

beforeEach(() => {
    loopReports = [];
    unexpectedErrors = [];
    // A generated table always carries a redirect cycle, and reaching it is a *pass* — the
    // store reports the loop it refused to keep following, which would otherwise bury the
    // run in output. Sort those from everything else rather than silencing the channel: a
    // React warning about this harness is a finding, and a blanket no-op would eat it.
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
        const first = typeof args[0] === 'string' ? args[0] : String(args[0]);
        if (first.includes('redirect loop')) loopReports.push(first);
        else unexpectedErrors.push(first);
    });
});

/**
 * The whole observable surface, checked against one model Step.
 *
 * `rendered` arrives as `{ oneOf }` only when a redirect cycle hit the depth guard: which
 * of the cycle's routes is left on screen follows from the cap's parity, and that is not
 * something the router promises (the deterministic pin makes the same call — see
 * `redirect.test.tsx`). What *is* promised, and asserted: following stops, one of the
 * cycle's routes renders, the loop is reported — and the trail is still exact.
 */
function assertStep(harness: Harness, step: Step, label: string) {
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

    // Following stopped exactly where the model says the guard stopped it — and nowhere
    // else. The negative half is the sharper one: an over-eager guard that gave up on an
    // honest redirect chain would report a loop that isn't there.
    if (step.reportedLoop) {
        expect(loopReports, `${label}: the refused loop must be reported`).not.toHaveLength(0);
    } else {
        expect(loopReports, `${label}: no loop to report`).toHaveLength(0);
    }
    // Nothing else may have gone to console.error — a React warning here would mean the
    // harness is driving the router in a way an app never would.
    expect(unexpectedErrors, `${label}: unexpected console.error`).toEqual([]);

    // The URL bar, and the router's reading of it.
    const location = harness.router.history.location;
    expect(location.pathname + location.search + location.hash, `${label}: url`).toBe(step.url);
    expect(harness.router.path, `${label}: router.path`).toBe(step.path);
    expect(harness.router.search, `${label}: router.search`).toBe(step.search);
    expect(harness.router.hash, `${label}: router.hash`).toBe(step.hash);
    expect(harness.router.state, `${label}: router.state`).toEqual(step.state);

    // The trail prepareRoute reports a 30x from.
    expect(harness.router.redirectHops, `${label}: redirectHops`).toEqual(step.hops);
}

/** Remount discipline: the ledger grew by exactly the mounts the model predicted, and its
 * newest entry is what is on screen. Mounts are observed through the probes' mount effects
 * — a render counter would fail the moment React legitimately re-rendered. */
function assertMounts(harness: Harness, model: RouterModel, step: Step, label: string) {
    expect(harness.mounts.length, `${label}: mount count`).toBe(model.mountCount());
    if (step.rendered !== null && !('oneOf' in step.rendered)) {
        // A skipped navigation leaves the previous mount newest, so this also says "the
        // route still mounted is the right one".
        expect(harness.mounts[harness.mounts.length - 1], `${label}: newest mount`).toEqual(
            step.rendered,
        );
    }
}

/*
    The non-vacuity gate (jnana's rule, carried from the mandala suite: "a green run that
    never exercised the machinery is a failure of the harness, not a pass").

    It has already earned its keep twice on this item. The first cut drew a navigation's
    search/hash independently of its form, which demoted all but ~1 navigation in 18 to a
    literal URL — so `getPath` was barely called, and the prefix-collision kill needed a 20x
    budget to land. The first cut also almost never repeated a URL, leaving the *skipped*
    navigation at ~1% of steps. Both were invisible in a green run; both are counted here
    now, so the next edit that starves a path says so.
*/
const exercised: Record<string, number> = {};
const note = (what: string) => {
    exercised[what] = (exercised[what] ?? 0) + 1;
};

/** Values the codec has to work for — anything `encodeURIComponent` does not leave alone. */
const isHostile = (value: string) => encodeURIComponent(value) !== value;

function noteWhatHappened(step: Step, nav: Nav) {
    if (step.hops.length > 0) note('a redirect was followed');
    if (step.hops.length > 1) note('a redirect chain was followed');
    if (step.reportedLoop) note('a redirect cycle hit the depth guard');
    if (!step.remounted) note('a navigation resolved nothing (no remount)');
    if (nav.form === 'reference') note('a navigation went through getPath');
    if (step.rendered !== null && !('oneOf' in step.rendered)) {
        if (step.rendered.name === 'catchAll') note('the catch-all answered');
        if (nav.target.kind === 'route' && step.rendered.name !== nav.target.name) {
            note('an earlier route shadowed the one asked for');
        }
        if (Object.values(step.rendered.params).some(isHostile)) {
            note('a URL-hostile param value round-tripped');
        }
    }
}

describe('router fuzz — smoke (navigation over generated route tables)', () => {
    test('the rendered route, the URL, and the router agree with the model at every step', async () => {
        await fc.assert(
            fc.asyncProperty(routerCaseArb(), async (routerCase) => {
                loopReports = [];
                const model = new RouterModel(routerCase.table, routerCase.initialUrl);
                let harness!: Harness;
                // Mount inside an async act, as the deterministic suites do: the Router
                // defers the active route, so the low-priority render has to be flushed
                // before anything is read.
                await act(async () => {
                    harness = buildHarness(routerCase.table, routerCase.initialUrl);
                });
                try {
                    const initial = model.initialStep();
                    assertStep(harness, initial, 'initial');
                    assertMounts(harness, model, initial, 'initial');

                    for (const [i, nav] of routerCase.navs.entries()) {
                        const url = urlFor(routerCase.table, nav.target, nav.search, nav.hash);
                        const step =
                            nav.mode === 'navigate'
                                ? model.navigate(url, nav.state)
                                : model.replace(url, nav.state);

                        loopReports = [];
                        await act(async () => {
                            applyNav(harness.router, routerCase.table, nav);
                        });
                        // The deferred route lands a render later; flush it before reading.
                        await act(async () => {});

                        const label = `${nav.mode}#${i} → ${url}`;
                        assertStep(harness, step, label);
                        assertMounts(harness, model, step, label);
                        noteWhatHappened(step, nav);
                    }

                    // The catch-all: nothing above left a stale route on screen. Every step
                    // was checked, so this restates the end state as one fact — the Router
                    // is showing what the *current* URL resolves to.
                    assertStep(harness, model.current(), 'final');
                } finally {
                    harness.dispose();
                }
            }),
            fuzz(25),
        );

        // Every one of these is reachable at the default budget. If one reads zero, the
        // arbitrary stopped generating a shape the property claims to cover — which is a
        // harness failure wearing a green run's clothes, so it fails here rather than
        // going unnoticed.
        for (const what of [
            'a redirect was followed',
            'a redirect chain was followed',
            'a redirect cycle hit the depth guard',
            'a navigation resolved nothing (no remount)',
            'a navigation went through getPath',
            'the catch-all answered',
            'an earlier route shadowed the one asked for',
            'a URL-hostile param value round-tripped',
        ]) {
            expect(exercised[what] ?? 0, `never exercised: ${what}`).toBeGreaterThan(0);
        }
    });
});
