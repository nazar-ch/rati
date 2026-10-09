import { describe, test, expect, afterEach, beforeEach, vi } from 'vite-plus/test';

import { cleanup, act } from '@testing-library/react';
import * as fc from 'fast-check';

import { atDeepFuzzBudget, fuzz, fuzzTimeout } from './arbitraries.js';
import {
    assertMounts,
    assertRenderedState,
    assertStep,
    installErrorLog,
    type ErrorLog,
} from './routerAsserts.js';
import { exercised, routerCommandsArb, type Real } from './routerCommands.js';
import { awayUrl, buildHarness, commandCaseArb, type Harness } from './routerHarness.js';
import { RouterModel } from './routerModel.js';

/*
    long:2
    The router's model-based property: a generated route table meets a generated COMMAND
    SEQUENCE — pushes and replaces by reference and by URL, shallow navigations, per-entry state,
    query rewrites, redirects, back/forward/go — against a real RouterStore over a memory history,
    mirrored in the model. Each command asserts the contract after itself (routerCommands.ts);
    this file owns the catch-all at quiesce and the teardown tail, that a disposed store let go
    of its history. It searches the interleavings the smoke property's forward navigation misses.
*/

afterEach(cleanup);
afterEach(() => vi.restoreAllMocks());

let log: ErrorLog;
beforeEach(() => {
    log = installErrorLog();
});

/**
 * The teardown tail: after `dispose()` the store has detached from its history, so driving
 * the history reaches nothing — driven while the tree is still mounted, where a store still
 * listening re-keys the route. A created history's DOM detach is `webRouterCore.test.ts`'s.
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
                            // the Router is showing what the CURRENT URL resolves to.
                            assertRenderedState(harness, model.current(), 'final');
                        } finally {
                            await assertDetachedAfterDispose(harness, model, routerCase.table);
                            harness.view.unmount();
                        }
                    },
                ),
                fuzz(25),
            );

            // The counters accumulate at every budget, but this shape guard ASSERTS only at
            // the deep budget the `fuzz` stage runs: a multi-step shape (a shallow entry armed,
            // left, then traversed back onto) is not reliably reached at the default one.
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
