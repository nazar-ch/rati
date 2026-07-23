import * as fc from 'fast-check';
import { describe, test, expect, afterEach, beforeEach, vi } from 'vite-plus/test';
import { cleanup, act } from '@testing-library/react';
import { fuzz, fuzzTimeout } from './arbitraries';
import { RouterModel, type Step } from './routerModel';
import {
    assertMounts,
    assertRenderedState,
    assertStep,
    installErrorLog,
    type ErrorLog,
} from './routerAsserts';
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

/**
 * A generated table always carries a redirect cycle, and reaching it is a *pass* — the store
 * reports the loop it refused to keep following. The log sorts those from everything else
 * rather than silencing the channel: a React warning about this harness is a finding, and a
 * blanket no-op would eat it. Shared with the command property (routerAsserts.ts), which
 * must hold the router to the same bar.
 */
let log: ErrorLog;
beforeEach(() => {
    log = installErrorLog();
});

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
    if (step.reportedLoop && !step.selfRedirect) note('a redirect cycle hit the depth guard');
    if (step.selfRedirect) note('a redirect resolved back to its own route');
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
        // The live half of the dot rule: a value *containing* dots is ordinary and must
        // survive untouched. (A value that is only dots has no URL at all — see the pool.)
        if (Object.values(step.rendered.params).some((value) => value.includes('.'))) {
            note('a param value carrying dots round-tripped');
        }
    }
}

describe('router fuzz — smoke (navigation over generated route tables)', () => {
    test(
        'the rendered route, the URL, and the router agree with the model at every step',
        async () => {
            await fc.assert(
                fc.asyncProperty(routerCaseArb(), async (routerCase) => {
                    log.reset();
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
                        assertStep(harness, initial, 'initial', log);
                        assertMounts(harness, model, initial, 'initial');

                        for (const [i, nav] of routerCase.navs.entries()) {
                            const url = urlFor(routerCase.table, nav.target, nav.search, nav.hash);
                            const step =
                                nav.mode === 'navigate'
                                    ? model.navigate(url, nav.state ?? null)
                                    : model.replace(url, nav.state ?? null);

                            log.reset();
                            await act(async () => {
                                applyNav(harness.router, routerCase.table, nav);
                            });
                            // The deferred route lands a render later; flush it before reading.
                            await act(async () => {});

                            const label = `${nav.mode}#${i} → ${url}`;
                            assertStep(harness, step, label, log);
                            assertMounts(harness, model, step, label);
                            noteWhatHappened(step, nav);
                        }

                        // The catch-all: nothing above left a stale route on screen. Every step
                        // was checked, so this restates the end state as one fact — the Router
                        // is showing what the *current* URL resolves to.
                        assertRenderedState(harness, model.current(), 'final');
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
                'a redirect resolved back to its own route',
                'a navigation resolved nothing (no remount)',
                'a navigation went through getPath',
                'the catch-all answered',
                'an earlier route shadowed the one asked for',
                'a URL-hostile param value round-tripped',
                'a param value carrying dots round-tripped',
            ]) {
                expect(exercised[what] ?? 0, `never exercised: ${what}`).toBeGreaterThan(0);
            }
        },
        fuzzTimeout(),
    );
});
