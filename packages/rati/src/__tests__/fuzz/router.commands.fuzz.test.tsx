import * as fc from 'fast-check';
import { describe, test, expect, afterEach, beforeEach, vi } from 'vite-plus/test';
import { cleanup, act } from '@testing-library/react';
import { atDeepFuzzBudget, fuzz, fuzzTimeout } from './arbitraries';
import { RouterModel } from './routerModel';
import {
    assertMounts,
    assertRenderedState,
    assertStep,
    installErrorLog,
    type ErrorLog,
} from './routerAsserts';
import { awayUrl, buildHarness, commandCaseArb, type Harness } from './routerHarness';
import { exercised, routerCommandsArb, type Real } from './routerCommands';

/*
    The RF-03 model-based property: a generated route table meets a generated *command
    sequence* — pushes and replaces by reference and by URL, shallow navigations, per-entry
    state, query rewrites, redirects, and the back/forward/go traversal — driven against a
    real RouterStore over a memory history and mirrored in the reference model.

    Each command asserts the contract after itself (routerCommands.ts). This file owns the
    two things only the whole run can say: the **catch-all** at quiesce (nothing above left
    a stale route on screen), and the **teardown tail** — that a disposed store has actually
    let go of the history it was given.

    Where the smoke property (RF-02) searches forward navigation over generated tables, this
    one searches the interleavings: a POP landing on a shallowly-created entry, a redirect
    reached by going back to it, state-only entries stepped through, shallow navigations
    stacked on each other. Route components are plain — data resolution under navigation is
    the mandala suite's ground, and folding an island in would put two engines in one
    property.
*/

afterEach(cleanup);
afterEach(() => vi.restoreAllMocks());

let log: ErrorLog;
beforeEach(() => {
    log = installErrorLog();
});

/**
 * The tail RF-03.4 asks for: after `dispose()`, the store has detached from the history it
 * was handed — driving that history reaches nothing.
 *
 * Driven while the tree is still mounted, which is the whole point: a store that never
 * unhooked its listener would resolve the new URL, re-key the route, and remount it, and
 * none of that is observable in a tree that has already been thrown away. The URL is chosen
 * to always resolve to *something* other than where the router is (`awayUrl`), so the
 * tripwire cannot come up vacuous.
 *
 * Deliberately not asserted here: the created-history DOM detach (RF-01's finding 4). This
 * harness injects its history, so `dispose()` never reaches `history.dispose()` — and that
 * leak has no store-level shadow anyway, which is why its pin lives at the History surface
 * in `webRouterCore.test.ts`, where it bites.
 */
async function assertDetachedAfterDispose(
    harness: Harness,
    model: RouterModel,
    table: Real['table'],
) {
    const mountsBefore = harness.mounts.length;
    const renderedBefore = harness.rendered();

    harness.router.dispose();

    await act(async () => {
        harness.router.history.push(awayUrl(table, model.currentPath()));
    });
    await act(async () => {});

    expect(harness.mounts.length, 'after dispose: nothing may remount').toBe(mountsBefore);
    expect(harness.rendered(), 'after dispose: nothing may re-render').toEqual(renderedBefore);
}

describe('router fuzz — commands (navigation interleavings over generated route tables)', () => {
    test(
        'the router agrees with the model after every command in any order',
        async () => {
            await fc.assert(
                fc.asyncProperty(
                    commandCaseArb(),
                    routerCommandsArb(),
                    async (routerCase, commands) => {
                        log.reset();
                        const model = new RouterModel(routerCase.table, routerCase.initialUrl);
                        let harness!: Harness;
                        // Mount inside an async act, as the deterministic suites do: the Router
                        // defers the active route, so the low-priority render has to be flushed
                        // before anything is read.
                        await act(async () => {
                            harness = buildHarness(routerCase.table, routerCase.initialUrl);
                        });
                        const real: Real = { harness, table: routerCase.table, log };

                        try {
                            const initial = model.initialStep();
                            assertStep(harness, initial, 'initial', log);
                            assertMounts(harness, model, initial, 'initial');

                            await fc.asyncModelRun(() => ({ model, real }), commands);

                            // The catch-all: nothing above left a stale route on screen. Every
                            // command was checked, so this restates the end state as one fact —
                            // the Router is showing what the *current* URL resolves to.
                            assertRenderedState(harness, model.current(), 'final');
                        } finally {
                            await assertDetachedAfterDispose(harness, model, routerCase.table);
                            harness.view.unmount();
                        }
                    },
                ),
                fuzz(25),
            );

            // The counters accumulate at every budget (routerCommands.ts `note`), but this
            // sixteen-shape guard only *asserts* at the deep budget the `fuzz` stage always
            // runs (FUZZ_RUNS=500) — the one place every shape is reliably reached. Two of
            // them need a multi-step conspiracy (a shallow entry armed, navigated away from,
            // then traversed back onto) that the default `fuzz(25)` budget reaches only
            // ~86% of runs, so asserting there cried wolf ~14% of the time — the failure
            // mode this guard exists to prevent, inverted (RF-09). At the deep budget it
            // still bites: a harness that stopped generating a shape fails here, loudly, on
            // every gate run. The first three are RF-03.3's by name.
            if (atDeepFuzzBudget()) {
                for (const what of [
                    'a traversal ran',
                    'a traversal landed on a stale shallow entry',
                    'a redirect cycle hit the depth guard',
                    'a traversal had nowhere to go',
                    'a traversal stepped between two same-URL entries differing in state',
                    'a traversal landed on a redirect and followed it',
                    'a shallow navigation kept the mounted route',
                    'a shallow entry carried per-entry state',
                    'a same-URL navigation with an equal state resolved nothing',
                    'a same-URL navigation with a different state re-resolved',
                    'a navigation resolved nothing (no remount)',
                    'a navigation went through getPath',
                    'a redirect was followed',
                    'a redirect resolved back to its own route',
                    'setSearchParams pushed an entry',
                    'setSearchParams replaced an entry',
                ]) {
                    expect(exercised[what] ?? 0, `never exercised: ${what}`).toBeGreaterThan(0);
                }
            }
        },
        fuzzTimeout(),
    );
});
