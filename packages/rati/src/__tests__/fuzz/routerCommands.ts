import { expect } from 'vite-plus/test';

import { act } from '@testing-library/react';
import * as fc from 'fast-check';

import { byLevel } from './arbitraries.js';
import { assertMounts, assertStep, type ErrorLog } from './routerAsserts.js';
import {
    HASH_VALUES,
    paramValues,
    referenceFor,
    SEARCH_VALUES,
    UNMATCHED_PATH,
    type Harness,
} from './routerHarness.js';
import type { RouterModel, RouteTable, Step } from './routerModel.js';

import { flush } from '../../testing/index.js';

/*
    long:2
    The router's command alphabet: the navigations an app makes — pushes and replaces by
    reference and by URL, shallow ones, per-entry state, query rewrites, redirects, and
    back/forward traversal — driven against a real RouterStore over a memory history and
    mirrored in routerModel.ts. commands.ts's conventions hold: targets picked at run time, and
    every mutation inside `act` then one fixed flush, since the Router defers the active route.
    routerAsserts.ts holds the shared invariants; notification coherence, a fact about a
    COMMAND, is here.
*/

export type Model = RouterModel;
export type Real = { harness: Harness; table: RouteTable; log: ErrorLog };

/*
    Non-vacuity across the whole run set: a green run that never exercised the machinery is the
    harness failing. Starvation comes from the arbitrary's JOINT distribution, so the shapes this
    alphabet exists for are counted.
*/
export const exercised: Record<string, number> = {};
const note = (what: string) => {
    exercised[what] = (exercised[what] ?? 0) + 1;
};

/**
 * The per-entry state pool. `A1` and `A2` are the `shallowEqualState` seam: DISTINCT objects
 * agreeing on every key, which the store reads as equal, so a reference comparison fails here.
 * The seam exists only where the URL repeats — `NavigateWithState`'s purpose.
 */
const STATE_A1 = { panelId: 'p0' };
const STATE_A2 = { panelId: 'p0' };
const STATE_B = { panelId: 'p1' };
const STATE_POOL: (Record<string, unknown> | null)[] = [null, STATE_A1, STATE_A2, STATE_B];

/** `?? null` rather than `!`: the pool's first entry IS `null` (a navigation that passes
 * no state at all), so asserting non-null here would be a type that lies. */
const pickState = (pick: number): Record<string, unknown> | null =>
    STATE_POOL[pick % STATE_POOL.length] ?? null;

/** The query rewrites `setSearchParams` is driven with — including one whose value needs
 * encoding, since `URLSearchParams` spells a space `+` where `getPath` spells it `%20`. */
const SEARCH_INITS: Record<string, string>[] = [{}, { tab: 'a' }, { a: '1', b: '2' }, { q: 'a b' }];

// The invariants that must hold after every command that resolved something.

async function assertAfter(
    model: Model,
    real: Real,
    step: Step,
    versionBefore: number,
    label: string,
): Promise<void> {
    // The deferred route lands a render later; flush it before reading anything.
    await flush();

    // 1, 2, 3, 5 — the rendered route, the URL bar, the public getters, the redirect trail.
    assertStep(real.harness, step, label, real.log);
    // 4 — remount discipline, observed through the route probes' mount effects.
    assertMounts(real.harness, model, step, label);
    // 6 — notification coherence.
    assertNotified(real, versionBefore, label);
    assertConsumerFresh(real, step, label);

    noteStep(step);
}

/**
 * The store told its consumers something moved, read through `getSnapshot`, the public half of
 * its `useSyncExternalStore` pair. A BOUND, not a count: a followed redirect resolves more than
 * once, but a command that moved the router never leaves consumers unaware.
 */
function assertNotified(real: Real, versionBefore: number, label: string): void {
    expect(
        real.harness.router.getSnapshot(),
        `${label}: a resolution must notify subscribers`,
    ).toBeGreaterThan(versionBefore);
}

/**
 * And the consumers acted on it: an ordinary `useRouter` component has the CURRENT values on
 * screen. A store emitting before writing its fields, or a snapshot that didn't move, leaves a
 * stale render here.
 */
function assertConsumerFresh(real: Real, step: Step, label: string): void {
    expect(real.harness.consumer(), `${label}: what a subscribed consumer last rendered`).toEqual({
        path: step.path,
        search: step.search,
        hash: step.hash,
    });
}

function noteStep(step: Step): void {
    if (step.hops.length > 0) note('a redirect was followed');
    if (step.hops.length > 1) note('a redirect chain was followed');
    if (step.reportedLoop && !step.selfRedirect) note('a redirect cycle hit the depth guard');
    if (step.selfRedirect) note('a redirect resolved back to its own route');
    if (step.suppressed) note('a shallow navigation kept the mounted route');
    if (step.staleShallowPop) note('a traversal landed on a stale shallow entry');
    if (!step.remounted && !step.suppressed) note('a navigation resolved nothing (no remount)');
    if (step.stateHasMark) note('a shallow entry carried per-entry state');
}

type NavDraw = {
    pick: number;
    /** Two, the most any generated path declares. */
    paramPicks: number[];
    /** The order the caller's reference object lists its params in. */
    keyPicks: number[];
    searchPick: number;
    hashPick: number;
    statePick: number;
    missPick: number;
};

const navDrawArb = (): fc.Arbitrary<NavDraw> =>
    fc.record({
        pick: fc.nat(),
        paramPicks: fc.array(fc.nat(), { minLength: 2, maxLength: 2 }),
        keyPicks: fc.array(fc.nat({ max: 99 }), { minLength: 2, maxLength: 2 }),
        searchPick: fc.nat(),
        hashPick: fc.nat(),
        statePick: fc.nat(),
        missPick: fc.nat(),
    });

type Target = { name: string; params: Record<string, string> };

function pickRoute(model: Model, names: string[], draw: NavDraw): Target {
    const name = names[draw.pick % names.length]!;
    const values = paramValues();
    const params: Record<string, string> = {};
    model.paramNamesFor(name).forEach((paramName, i) => {
        params[paramName] = values[(draw.paramPicks[i] ?? 0) % values.length]!;
    });
    return { name, params };
}

abstract class NavCommand implements fc.AsyncCommand<Model, Real> {
    constructor(protected readonly draw: NavDraw) {}

    protected abstract get mode(): 'navigate' | 'replace';
    /** `reference` is `{ name, …params }` — the only form that goes through `getPath`;
     * `string` is a literal URL, the only form that can carry a query or a fragment. */
    protected abstract get form(): 'reference' | 'string';
    protected abstract get verb(): string;
    protected get shallow(): boolean {
        return false;
    }
    protected targets(model: Model): string[] {
        return model.navigable();
    }
    /** Whether this command may aim at a URL no route answers — the catch-all's only door. */
    protected get mayMiss(): boolean {
        return true;
    }

    check(): boolean {
        return true;
    }

    async run(model: Model, real: Real): Promise<void> {
        // A reference has nowhere to put a query or fragment, so the two are decided together;
        // independent draws starve `getPath`.
        const literal = this.form === 'string';
        const search = literal ? SEARCH_VALUES[this.draw.searchPick % SEARCH_VALUES.length]! : '';
        const hash = literal ? HASH_VALUES[this.draw.hashPick % HASH_VALUES.length]! : '';
        const state = pickState(this.draw.statePick);

        // A URL nothing answers is only expressible as a literal — `*` is not a path
        // `getPath` can build from.
        const miss = literal && this.mayMiss && this.draw.missPick % 10 === 0;
        const target = miss ? null : pickRoute(model, this.targets(model), this.draw);
        const url = target
            ? model.url(target.name, target.params, search, hash)
            : real.table.basename + UNMATCHED_PATH + search + hash;
        const to =
            target && !literal ? referenceFor(target.name, target.params, this.draw.keyPicks) : url;

        const options = {
            ...(state ? { state } : {}),
            ...(this.shallow ? { keepCurrentRoute: true } : {}),
        };

        const versionBefore = real.harness.router.getSnapshot();
        const step =
            this.mode === 'navigate'
                ? model.navigate(url, state, this.shallow)
                : model.replace(url, state, this.shallow);

        real.log.reset();
        await act(async () => {
            if (this.mode === 'navigate') real.harness.router.navigate(to as never, options);
            else real.harness.router.replace(to as never, options);
        });
        await assertAfter(model, real, step, versionBefore, `${this.verb} → ${url}`);
        if (!literal) note('a navigation went through getPath');
    }

    /**
     * Reports the GENERATED draw: fast-check clones commands between runs, so a target stashed
     * on `this` can print the wrong one. The resolved URL rides every assertion message.
     */
    toString(): string {
        return `${this.verb}#${this.draw.pick}`;
    }
}

class NavigateRef extends NavCommand {
    protected get mode() {
        return 'navigate' as const;
    }
    protected get form() {
        return 'reference' as const;
    }
    protected get verb() {
        return 'navigateRef';
    }
}

class NavigatePath extends NavCommand {
    protected get mode() {
        return 'navigate' as const;
    }
    protected get form() {
        return 'string' as const;
    }
    protected get verb() {
        return 'navigatePath';
    }
}

class ReplaceRef extends NavCommand {
    protected get mode() {
        return 'replace' as const;
    }
    protected get form() {
        return 'reference' as const;
    }
    protected get verb() {
        return 'replaceRef';
    }
}

class ReplacePath extends NavCommand {
    protected get mode() {
        return 'replace' as const;
    }
    protected get form() {
        return 'string' as const;
    }
    protected get verb() {
        return 'replacePath';
    }
}

/**
 * A shallow push: the back stack grows and the URL moves, the mounted route stays. The literal
 * form, so the change can be a query rewrite; its `replace` twin takes the reference form, so
 * the pair covers both doors into `pushOrReplace`.
 */
class NavigateShallow extends NavCommand {
    protected get mode() {
        return 'navigate' as const;
    }
    protected get form() {
        return 'string' as const;
    }
    protected override get shallow() {
        return true;
    }
    protected get verb() {
        return 'navigateShallow';
    }
}

class ReplaceShallow extends NavCommand {
    protected get mode() {
        return 'replace' as const;
    }
    protected get form() {
        return 'reference' as const;
    }
    protected override get shallow() {
        return true;
    }
    protected get verb() {
        return 'replaceShallow';
    }
}

/**
 * Navigates into a redirect route on purpose — a single hop, the cycle pair, or the
 * self-target. The literal form, so a query rides into the resolution: an OBJECT target
 * re-attaches the current search and hash, a branch of `resolveTarget` nothing else reaches.
 */
class ToRedirectRoute extends NavCommand {
    protected get mode() {
        return 'navigate' as const;
    }
    protected get form() {
        return 'string' as const;
    }
    protected get verb() {
        return 'toRedirectRoute';
    }
    protected override targets(model: Model) {
        return model.redirectNames();
    }
    protected override get mayMiss() {
        return false;
    }
}

/**
 * Navigates to the URL on screen with a drawn per-entry state — the `shallowEqualState` seam,
 * which exists only where the URL repeats. An equal state resolves nothing, a different one
 * re-resolves the same URL, and the second entry sharing a URL is what a later traversal
 * steps between.
 */
class NavigateWithState implements fc.AsyncCommand<Model, Real> {
    constructor(private readonly statePick: number) {}

    check(): boolean {
        return true;
    }

    async run(model: Model, real: Real): Promise<void> {
        const state = pickState(this.statePick);
        const url = model.currentUrl();
        const before = model.current();

        const versionBefore = real.harness.router.getSnapshot();
        const step = model.navigate(url, state);

        real.log.reset();
        await act(async () => {
            real.harness.router.navigate(url as never, state ? { state } : {});
        });
        await assertAfter(model, real, step, versionBefore, `navigateWithState → ${url}`);

        if (!step.remounted) note('a same-URL navigation with an equal state resolved nothing');
        else if (sameUserState(before, step)) note('a same-URL navigation re-resolved anyway');
        else note('a same-URL navigation with a different state re-resolved');
    }

    toString(): string {
        return `navigateWithState#${this.statePick % STATE_POOL.length}`;
    }
}

/** `setSearchParams` — the query rewritten in place, pushing or replacing. */
class SetSearchParams implements fc.AsyncCommand<Model, Real> {
    constructor(
        private readonly mode: 'push' | 'replace',
        private readonly pick: number,
    ) {}

    check(): boolean {
        return true;
    }

    async run(model: Model, real: Real): Promise<void> {
        const init = SEARCH_INITS[this.pick % SEARCH_INITS.length]!;
        // `URLSearchParams` is the platform primitive the store's contract names ("accepts
        // anything URLSearchParams accepts") — serializing with it here is the same move as
        // the model naming `encodeURIComponent`, not the model borrowing router code.
        const search = new URLSearchParams(init).toString();

        const versionBefore = real.harness.router.getSnapshot();
        const step = model.setSearchParams(search, this.mode);

        real.log.reset();
        await act(async () => {
            real.harness.router.setSearchParams(init, { mode: this.mode });
        });
        await assertAfter(
            model,
            real,
            step,
            versionBefore,
            `setSearchParams:${this.mode} ?${search}`,
        );
        note(`setSearchParams ${this.mode === 'push' ? 'pushed' : 'replaced'} an entry`);
    }

    toString(): string {
        return `setSearchParams:${this.mode}#${this.pick % SEARCH_INITS.length}`;
    }
}

/**
 * `go(delta)` over the entry stack, ungated: a delta with nowhere to go is CONTRACT — out of
 * range never clamps, and `go(0)` has no document in memory — so this command asserts that
 * nothing happened, not even a notification.
 */
class Go implements fc.AsyncCommand<Model, Real> {
    constructor(private readonly delta: number) {}

    check(): boolean {
        return true;
    }

    async run(model: Model, real: Real): Promise<void> {
        const label = `go(${this.delta})`;
        const versionBefore = real.harness.router.getSnapshot();
        const renderedBefore = real.harness.rendered();
        const mountsBefore = real.harness.mounts.length;
        const locationBefore = real.harness.router.history.location;
        const urlBefore = locationBefore.pathname + locationBefore.search + locationBefore.hash;

        const before = model.current();
        const step = model.go(this.delta);

        real.log.reset();
        await act(async () => {
            real.harness.router.history.go(this.delta);
        });
        await flush();

        if (step === null) {
            // Nothing to do means NOTHING: no resolution, no re-render, and no
            // notification — a store that re-emitted here would make every consumer in the
            // app re-read for a traversal that never happened.
            const location = real.harness.router.history.location;
            expect(location.pathname + location.search + location.hash, `${label}: url`).toBe(
                urlBefore,
            );
            expect(real.harness.router.getSnapshot(), `${label}: nothing to notify`).toBe(
                versionBefore,
            );
            expect(real.harness.rendered(), `${label}: nothing re-rendered`).toEqual(
                renderedBefore,
            );
            expect(real.harness.mounts.length, `${label}: nothing remounted`).toBe(mountsBefore);
            expect(real.log.loops.concat(real.log.unexpected), `${label}: nothing logged`).toEqual(
                [],
            );
            note('a traversal had nowhere to go');
            return;
        }

        await assertAfter(model, real, step, versionBefore, label);
        noteTraversal(before, step);
    }

    toString(): string {
        return `go(${this.delta})`;
    }
}

/** `back()` / `forward()`, gated on there being an entry to land on — an out-of-range one
 * is `Go`'s business, and spending a command on it here would just thin the traversal. */
abstract class Step1 implements fc.AsyncCommand<Model, Real> {
    protected abstract get delta(): -1 | 1;
    protected abstract get verb(): 'back' | 'forward';

    check(model: Model): boolean {
        return model.canGo(this.delta);
    }

    async run(model: Model, real: Real): Promise<void> {
        const versionBefore = real.harness.router.getSnapshot();
        const before = model.current();
        const step = model.go(this.delta)!;

        real.log.reset();
        await act(async () => {
            if (this.verb === 'back') real.harness.router.history.back();
            else real.harness.router.history.forward();
        });
        await assertAfter(model, real, step, versionBefore, this.verb);
        noteTraversal(before, step);
    }

    toString(): string {
        return this.verb;
    }
}

class Back extends Step1 {
    protected get delta() {
        return -1 as const;
    }
    protected get verb() {
        return 'back' as const;
    }
}

class Forward extends Step1 {
    protected get delta() {
        return 1 as const;
    }
    protected get verb() {
        return 'forward' as const;
    }
}

function sameUserState(a: Step, b: Step): boolean {
    return JSON.stringify(a.state) === JSON.stringify(b.state);
}

function noteTraversal(before: Step, step: Step): void {
    note('a traversal ran');
    if (step.url === before.url) {
        // The shape invariant 3 exists for: two entries sharing a URL, differing in state.
        // Whether it re-resolved is `assertMounts`'s business — this only says it was tried.
        if (!sameUserState(before, step)) {
            note('a traversal stepped between two same-URL entries differing in state');
        }
    }
    if (step.hops.length > 0) note('a traversal landed on a redirect and followed it');
}

/**
 * The alphabet. Weighted by hand: the traversal verbs and the state seam are what this
 * property exists for, while an unweighted mix would spend most sequences pushing fresh
 * URLs onto a stack it never walks back down.
 */
export const routerCommandsArb = (): fc.Arbitrary<Iterable<fc.AsyncCommand<Model, Real>>> =>
    fc.commands(
        [
            navDrawArb().map((draw) => new NavigateRef(draw)),
            navDrawArb().map((draw) => new NavigateRef(draw)),
            navDrawArb().map((draw) => new NavigatePath(draw)),
            navDrawArb().map((draw) => new NavigatePath(draw)),
            navDrawArb().map((draw) => new ReplaceRef(draw)),
            navDrawArb().map((draw) => new ReplacePath(draw)),
            navDrawArb().map((draw) => new NavigateShallow(draw)),
            navDrawArb().map((draw) => new NavigateShallow(draw)),
            navDrawArb().map((draw) => new ReplaceShallow(draw)),
            navDrawArb().map((draw) => new ToRedirectRoute(draw)),
            navDrawArb().map((draw) => new ToRedirectRoute(draw)),
            fc.nat().map((pick) => new NavigateWithState(pick)),
            fc.nat().map((pick) => new NavigateWithState(pick)),
            fc.nat().map((pick) => new NavigateWithState(pick)),
            fc.nat().map((pick) => new SetSearchParams('push', pick)),
            fc.nat().map((pick) => new SetSearchParams('replace', pick)),
            fc.constant(new Back()),
            fc.constant(new Back()),
            fc.constant(new Back()),
            fc.constant(new Forward()),
            fc.constant(new Forward()),
            // Out of range as often as in: the inert half is contract too.
            fc.integer({ min: -3, max: 3 }).map((delta) => new Go(delta)),
            fc.integer({ min: -3, max: 3 }).map((delta) => new Go(delta)),
        ],
        { maxCommands: byLevel(14, 6), size: 'large' },
    );
