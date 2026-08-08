import { describe, test, expect, afterEach, beforeEach, vi } from 'vite-plus/test';

import { act } from 'react';

import { island } from '../../island/island';
import {
    RetryPolicy,
    resolveRetry,
    DEFAULT_BACKOFF_MS,
    MAX_BACKOFF_MS,
} from '../../mandala/retryPolicy';
import { scope, input } from '../../scope/scope';
import { NotAvailableError, type SourceError } from '../../scope/source';
import { flush, renderIsland, ssrRender, cleanup } from '../../testing';

/*
    `retry` — the island takes another go at a failed resolution before it gives up.

    The shape the pins hold: an accepted failure is *not* an error state. The island keeps
    showing what it shows while resolving (the loading slot, or the kept run under
    `keepStale`), the error slot never mounts, and `retrying` says which attempt is in
    flight. Only a spent budget — or a failure that was never a transient fault — puts the
    error slot up, and the manual `retry` on it starts over.

    Who is retried at all is the two-level error's business (DATA-10). The policy is **on by
    default** and reads `retryable`: a classified transient failure is retried with no
    config at all, a terminal one never is. An island that asks for a policy explicitly gets
    a broader reach — the unclassified `failed` a bare `throw new Error` produces — and
    `retry: false` opts out of the whole thing.

    The cadence is exponential from `backoffMs`, drawn with **full jitter**: each wait is a
    random point in `[0, ceiling]`. `Math.random` is stubbed at 1 below so the pins can name
    an exact tick — that is the ceiling itself, the longest wait the schedule can produce.
*/

const BACKOFF = 500;
const POLICY = { count: 2, backoffMs: BACKOFF };

type Attempts = { calls: string[]; failing: boolean; throws?: () => unknown };

/** What an app's transport edge throws: a plain error carrying both levels. */
function classified(code: string, retryable: boolean) {
    return () => Object.assign(new Error(`${code} failure`), { code, retryable });
}

/**
 * A scope whose one load fails while `attempts.failing` is set, recording every call. The
 * `id` input is there so the param-change pin has something to change; `throws` is what it
 * fails with (an unclassified `Error` unless a test says otherwise).
 */
function flakyConfig(attempts: Attempts, extra = {}) {
    return {
        scope: scope({ id: input<string>() }).load({
            label: async ({ id }: { id: string }) => {
                attempts.calls.push(id);
                if (attempts.failing)
                    throw (attempts.throws ?? (() => new Error('backend exploded')))();
                return `page ${id}`;
            },
        }),
        component: ({ label }: { label: string }) => <div>{label}</div>,
        loading: () => <div>loading slot</div>,
        error: ({ error }: { error: SourceError }) => <div>error: {error.code}</div>,
        retry: POLICY,
        ...extra,
    };
}

describe('retry — the client', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        // The longest draw the jitter can make, so a wait is exactly its ceiling and the
        // cadence pins below can name a tick. The jitter itself is pinned further down.
        vi.spyOn(Math, 'random').mockReturnValue(1);
    });
    afterEach(() => {
        cleanup();
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    /** Step the fake clock and let the generation it started resolve (or fail) all the way. */
    async function advance(ms: number): Promise<void> {
        await act(async () => {
            vi.advanceTimersByTime(ms);
        });
        await flush(2);
    }

    test('a failed load is retried `count` times at a doubling cadence, then gives up', async () => {
        const attempts: Attempts = { calls: [], failing: true };
        const handle = await renderIsland(flakyConfig(attempts), { props: { id: 'a' } });

        // The first failure is already absorbed — the island reads as still resolving.
        expect(attempts.calls).toHaveLength(1);
        expect(handle.slot()).toBe('loading');
        expect(handle.controls().retrying).toBe(1);

        // ...and it waits the full base backoff, not a moment less.
        await advance(BACKOFF - 1);
        expect(attempts.calls).toHaveLength(1);
        await advance(1);
        expect(attempts.calls).toHaveLength(2);
        expect(handle.controls().retrying).toBe(2);

        // The second wait doubles.
        await advance(BACKOFF * 2 - 1);
        expect(attempts.calls).toHaveLength(2);
        await advance(1);
        expect(attempts.calls).toHaveLength(3);

        // Budget spent: the error slot at last, with nothing left counting down.
        expect(handle.slot()).toBe('error');
        expect(handle.text()).toBe('error: failed');
        expect(handle.controls().retrying).toBe(0);
        expect(vi.getTimerCount()).toBe(0);
    });

    test('the error slot does not mount while the policy is still working', async () => {
        const attempts: Attempts = { calls: [], failing: true };
        let errorRenders = 0;
        const handle = await renderIsland(
            flakyConfig(attempts, {
                error: () => {
                    errorRenders++;
                    return <div>error slot</div>;
                },
            }),
            { props: { id: 'a' } },
        );

        // The whole reason the decision is made in the boundary's *render*: a slot that
        // mounted and unmounted would have run its effects — the toast, the Sentry report.
        expect(errorRenders).toBe(0);
        await advance(BACKOFF);
        expect(errorRenders).toBe(0);
        expect(handle.slot()).toBe('loading');

        await advance(BACKOFF * 2);
        expect(errorRenders).toBeGreaterThan(0);
        expect(handle.slot()).toBe('error');
    });

    test('an attempt that succeeds renders content and stops the policy', async () => {
        const attempts: Attempts = { calls: [], failing: true };
        const handle = await renderIsland(flakyConfig(attempts), { props: { id: 'a' } });
        expect(handle.slot()).toBe('loading');

        attempts.failing = false;
        await advance(BACKOFF);

        expect(handle.slot()).toBe('content');
        expect(handle.text()).toBe('page a');
        expect(handle.controls().retrying).toBe(0);
        // The second attempt was never spent, and nothing is counting down toward it.
        expect(attempts.calls).toHaveLength(2);
        expect(vi.getTimerCount()).toBe(0);
    });

    test('not-available is never retried — an answer is not a fault', async () => {
        const calls: string[] = [];
        const handle = await renderIsland(
            {
                scope: scope({ id: input<string>() }).load({
                    label: async ({ id }: { id: string }) => {
                        calls.push(id);
                        throw new NotAvailableError('no such page');
                    },
                }),
                component: ({ label }: { label: string }) => <div>{label}</div>,
                loading: () => <div>loading slot</div>,
                error: ({ error }: { error: SourceError }) => <div>error: {error.code}</div>,
                retry: POLICY,
            },
            { props: { id: 'a' } },
        );

        // Straight to the slot the user is owed: one call, no backoff, no delay. Even an
        // explicit policy's broader reach stops at the code a load coined.
        expect(calls).toHaveLength(1);
        expect(handle.slot()).toBe('error');
        expect(handle.text()).toBe('error: not-available');
        expect(handle.controls().retrying).toBe(0);
        expect(vi.getTimerCount()).toBe(0);
    });

    test('a manual retry after exhaustion works, and buys a fresh budget', async () => {
        const attempts: Attempts = { calls: [], failing: true };
        const handle = await renderIsland(flakyConfig(attempts), { props: { id: 'a' } });
        await advance(BACKOFF);
        await advance(BACKOFF * 2);
        expect(handle.slot()).toBe('error');
        expect(attempts.calls).toHaveLength(3);

        await act(async () => {
            handle.controls().retry();
        });
        await flush(2);

        // A human clicking is new information: the streak starts over rather than landing
        // straight back in the error slot.
        expect(attempts.calls).toHaveLength(4);
        expect(handle.slot()).toBe('loading');
        expect(handle.controls().retrying).toBe(1);

        attempts.failing = false;
        await advance(BACKOFF);
        expect(handle.slot()).toBe('content');
        expect(handle.text()).toBe('page a');
    });

    test('with keepStale the previous content stays up through the whole cycle', async () => {
        const attempts: Attempts = { calls: [], failing: false };
        const handle = await renderIsland(flakyConfig(attempts, { keepStale: true }), {
            props: { id: 'a' },
        });
        expect(handle.text()).toBe('page a');

        attempts.failing = true;
        await handle.rerender({ id: 'b' });

        // The failure was absorbed, so the stale window never ended — the error slot would
        // have replaced the kept content, and a retry in progress is not an error.
        expect(handle.slot()).toBe('content');
        expect(handle.text()).toBe('page a');
        expect(handle.controls()).toMatchObject({ phase: 'ready', isStale: true, retrying: 1 });

        await advance(BACKOFF);
        expect(handle.text()).toBe('page a');
        expect(handle.controls().retrying).toBe(2);

        attempts.failing = false;
        await advance(BACKOFF * 2);
        expect(handle.text()).toBe('page b');
        expect(handle.controls()).toMatchObject({ phase: 'ready', isStale: false, retrying: 0 });
    });

    test('new inputs drop a pending attempt and restore the budget', async () => {
        const attempts: Attempts = { calls: [], failing: true };
        const before = vi.getTimerCount();
        const handle = await renderIsland(flakyConfig(attempts), { props: { id: 'a' } });
        expect(vi.getTimerCount()).toBe(before + 1);

        attempts.failing = false;
        await handle.rerender({ id: 'b' });

        // The countdown was about a screen that no longer exists; letting it fire would
        // re-resolve the *new* inputs for no reason.
        expect(vi.getTimerCount()).toBe(before);
        expect(handle.text()).toBe('page b');
        expect(handle.controls().retrying).toBe(0);

        // ...and the budget came back with the new bucket: two more attempts, not none.
        attempts.failing = true;
        await handle.rerender({ id: 'c' });
        expect(handle.controls().retrying).toBe(1);
        await advance(BACKOFF);
        expect(handle.controls().retrying).toBe(2);
        await advance(BACKOFF * 2);
        expect(handle.slot()).toBe('error');
    });

    test('unmounting mid-backoff leaves no timer behind', async () => {
        const attempts: Attempts = { calls: [], failing: true };
        const before = vi.getTimerCount();

        const handle = await renderIsland(flakyConfig(attempts), { props: { id: 'a' } });
        expect(vi.getTimerCount()).toBe(before + 1);

        handle.unmount();
        expect(vi.getTimerCount()).toBe(before);
    });

    test('count: 0 and `retry: false` are the opt-out — the error slot, on the spot', async () => {
        for (const option of [{ count: 0, backoffMs: BACKOFF }, false]) {
            const attempts: Attempts = {
                calls: [],
                failing: true,
                // Transient, and still not retried: opting out means opting out.
                throws: classified('failed', true),
            };
            const before = vi.getTimerCount();
            const handle = await renderIsland(flakyConfig(attempts, { retry: option }), {
                props: { id: 'a' },
            });

            expect(handle.slot()).toBe('error');
            expect(attempts.calls).toHaveLength(1);
            expect(handle.controls().retrying).toBe(0);
            expect(vi.getTimerCount()).toBe(before);
            cleanup();
        }
    });
});

describe('retry — live-shaped timing', () => {
    /*
        The pins above throw in a microtask under a jitter pinned at its ceiling — one corner
        of the timing square. A real fetch settles on a later macrotask, and full jitter
        legally draws near zero; that corner is where the boundary's stale-error render used
        to spend the next attempt before its load ran and arm the backoff concurrently with
        it (FND-07). These pins hold the other corners.
    */
    beforeEach(() => {
        vi.useFakeTimers();
    });
    afterEach(() => {
        cleanup();
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    async function advance(ms: number): Promise<void> {
        await act(async () => {
            vi.advanceTimersByTime(ms);
        });
        await flush(2);
    }

    const LATENCY = 5;

    /** A fetch-shaped failure: the load rejects `LATENCY` ms after it starts, on a macrotask. */
    function slowConfig(calls: number[], clock: { now: number }, extra = {}) {
        return {
            scope: scope({ id: input<string>() }).load({
                label: ({ id: _id }: { id: string }) =>
                    new Promise<string>((_, reject) => {
                        calls.push(clock.now);
                        setTimeout(() => reject(classified('failed', true)()), LATENCY);
                    }),
            }),
            component: ({ label }: { label: string }) => <div>{label}</div>,
            loading: () => <div>loading slot</div>,
            error: ({ error }: { error: SourceError }) => <div>error: {error.code}</div>,
            retry: POLICY,
            ...extra,
        };
    }

    /** Step fake time 1ms at a time so `clock.now` tracks when each load actually started. */
    async function run(clock: { now: number }, ms: number): Promise<void> {
        for (let tick = 0; tick < ms; tick++) {
            clock.now += 1;
            await advance(1);
        }
    }

    test('the backoff counts from the failure, not from the attempt’s start', async () => {
        vi.spyOn(Math, 'random').mockReturnValue(1);
        const calls: number[] = [];
        const clock = { now: 0 };
        const handle = await renderIsland(slowConfig(calls, clock), { props: { id: 'a' } });

        // Attempt 1 starts at 0 and fails at LATENCY; the first wait runs from the failure.
        await run(clock, LATENCY + BACKOFF - 1);
        expect(calls).toHaveLength(1);
        await run(clock, 1);
        expect(calls).toEqual([0, LATENCY + BACKOFF]);

        // Attempt 2 fails LATENCY later; the doubled wait runs from *that* failure — armed
        // when the attempt started, the third would land BACKOFF*2 early, mid-flight.
        await run(clock, LATENCY + BACKOFF * 2 - 1);
        expect(calls).toHaveLength(2);
        await run(clock, 1);
        expect(calls).toEqual([0, LATENCY + BACKOFF, (LATENCY + BACKOFF) * 2 + BACKOFF]);

        await run(clock, LATENCY);
        expect(handle.slot()).toBe('error');
        expect(vi.getTimerCount()).toBe(0);
    });

    test('a near-zero jitter draw still walks the whole schedule to the error slot', async () => {
        // A draw of 0 is a legal full-jitter outcome. Before the fix it fired the
        // prematurely-armed timer while the attempt was still in flight: the in-flight
        // generation was discarded unjudged, an unbudgeted extra load ran after the budget
        // was spent, and the error slot mounted transiently on the way.
        vi.spyOn(Math, 'random').mockReturnValue(0);
        let errorRenders = 0;
        const calls: number[] = [];
        const clock = { now: 0 };
        const handle = await renderIsland(
            slowConfig(calls, clock, {
                error: ({ error }: { error: SourceError }) => {
                    errorRenders++;
                    return <div>error: {error.code}</div>;
                },
            }),
            { props: { id: 'a' } },
        );

        for (let tick = 0; tick < LATENCY * 8; tick++) {
            await run(clock, 1);
            // The slot the policy shows while working is loading, all the way through —
            // a transient error-slot mount would have counted a render by now.
            if (handle.slot() !== 'error') expect(errorRenders).toBe(0);
        }

        expect(handle.slot()).toBe('error');
        // Exactly the budget: the initial attempt plus `count` retries, each started only
        // after the previous one failed — no discarded mid-flight attempt, no bonus load.
        expect(calls).toHaveLength(1 + POLICY.count);
        const failures = calls.map((start) => start + LATENCY);
        calls.slice(1).forEach((start, index) => {
            expect(start).toBeGreaterThanOrEqual(failures[index]!);
        });
        expect(handle.controls().retrying).toBe(0);
        expect(vi.getTimerCount()).toBe(0);
    });
});

describe('retry — default-on, no config at all', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.spyOn(Math, 'random').mockReturnValue(1);
    });
    afterEach(() => {
        cleanup();
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    async function advance(ms: number): Promise<void> {
        await act(async () => {
            vi.advanceTimersByTime(ms);
        });
        await flush(2);
    }

    /** The same flaky island, with the `retry` key genuinely absent. */
    function unconfigured(attempts: Attempts, extra = {}) {
        return flakyConfig(attempts, { retry: undefined, ...extra });
    }

    test('a transient failure retries — the whole point of default-on', async () => {
        const attempts: Attempts = { calls: [], failing: true, throws: classified('failed', true) };
        const handle = await renderIsland(unconfigured(attempts), { props: { id: 'a' } });

        // No `retry` option anywhere, and the island is already on its second attempt.
        expect(attempts.calls).toHaveLength(1);
        expect(handle.slot()).toBe('loading');
        expect(handle.controls().retrying).toBe(1);

        attempts.failing = false;
        await advance(DEFAULT_BACKOFF_MS);

        expect(handle.slot()).toBe('content');
        expect(handle.text()).toBe('page a');
        expect(attempts.calls).toHaveLength(2);
    });

    test('a terminal failure reaches the error slot with no extra attempts', async () => {
        const attempts: Attempts = {
            calls: [],
            failing: true,
            // The 403 shape: FND-02's acceptance check, on an island with no retry config.
            throws: classified('forbidden', false),
        };
        const before = vi.getTimerCount();
        const handle = await renderIsland(unconfigured(attempts), { props: { id: 'a' } });

        expect(handle.slot()).toBe('error');
        expect(handle.text()).toBe('error: forbidden');
        expect(attempts.calls).toHaveLength(1);
        expect(handle.controls().retrying).toBe(0);
        expect(vi.getTimerCount()).toBe(before);
    });

    test('an unclassified failure is not retried either — classifying is what buys it', async () => {
        const attempts: Attempts = { calls: [], failing: true };
        const before = vi.getTimerCount();
        const handle = await renderIsland(unconfigured(attempts), { props: { id: 'a' } });

        // An app that never classifies is exactly where default-on retry would hammer its
        // 404s, so it gets the behavior it had before the default existed.
        expect(handle.slot()).toBe('error');
        expect(attempts.calls).toHaveLength(1);
        expect(handle.controls().retrying).toBe(0);
        expect(vi.getTimerCount()).toBe(before);
    });

    test('the default budget is two attempts, then the error slot', async () => {
        const attempts: Attempts = { calls: [], failing: true, throws: classified('failed', true) };
        const handle = await renderIsland(unconfigured(attempts), { props: { id: 'a' } });

        await advance(DEFAULT_BACKOFF_MS);
        expect(attempts.calls).toHaveLength(2);
        await advance(DEFAULT_BACKOFF_MS * 2);
        expect(attempts.calls).toHaveLength(3);

        expect(handle.slot()).toBe('error');
        expect(handle.controls().retrying).toBe(0);
        expect(vi.getTimerCount()).toBe(0);
    });

    test('an explicit policy declines a terminal failure too — the FND-02 fix', async () => {
        const attempts: Attempts = {
            calls: [],
            failing: true,
            throws: classified('forbidden', false),
        };
        const before = vi.getTimerCount();
        const handle = await renderIsland(flakyConfig(attempts), { props: { id: 'a' } });

        // The configured island used to hammer this one `count` times over.
        expect(handle.slot()).toBe('error');
        expect(attempts.calls).toHaveLength(1);
        expect(vi.getTimerCount()).toBe(before);
    });
});

describe('retry — the backoff schedule', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    /** Drive a policy's arm loop directly and collect the waits it schedules. */
    function waitsFor(settings: { count: number; backoffMs: number }): number[] {
        const waits: number[] = [];
        const timer = vi.spyOn(globalThis, 'setTimeout').mockImplementation(((
            _fn: () => void,
            ms?: number,
        ) => {
            waits.push(ms ?? 0);
            return 0 as unknown as ReturnType<typeof setTimeout>;
        }) as unknown as typeof setTimeout);
        const policy = new RetryPolicy(resolveRetry(settings)!);
        policy.wire({ retry: () => {}, report: () => {} });
        for (let attempt = 0; attempt < settings.count; attempt++) {
            // A fresh generation each time — that is what buys the next attempt.
            policy.accept({ code: 'failed', retryable: true }, `gen-${attempt}`);
            policy.arm();
        }
        timer.mockRestore();
        return waits;
    }

    test('every wait is a draw inside its doubling ceiling, and the ceiling is capped', () => {
        const backoffMs = 1000;
        const waits = waitsFor({ count: 8, backoffMs });

        expect(waits).toHaveLength(8);
        waits.forEach((wait, index) => {
            const ceiling = Math.min(MAX_BACKOFF_MS, backoffMs * 2 ** index);
            expect(wait).toBeGreaterThanOrEqual(0);
            expect(wait).toBeLessThanOrEqual(ceiling);
        });
        // The cap binds well before the last attempt — an un-capped schedule would ask for
        // 128s here, which is a hang wearing a spinner.
        expect(Math.max(...waits)).toBeLessThanOrEqual(MAX_BACKOFF_MS);
    });

    test('the draws differ — the schedule is a ceiling, not an appointment', () => {
        // Un-jittered, every island that failed in the same blip comes back on the same
        // tick. 8 identical draws off a 10s ceiling is not something to see in a lifetime.
        const waits = waitsFor({ count: 8, backoffMs: MAX_BACKOFF_MS });
        expect(new Set(waits).size).toBeGreaterThan(1);
    });

    test('`backoffMs` is optional — the default fills in', () => {
        vi.spyOn(Math, 'random').mockReturnValue(1);
        expect(waitsFor({ count: 1, backoffMs: DEFAULT_BACKOFF_MS })).toEqual([DEFAULT_BACKOFF_MS]);
        expect(resolveRetry({ count: 1 })).toMatchObject({ backoffMs: DEFAULT_BACKOFF_MS });
    });
});

describe('retry — SSR', () => {
    afterEach(cleanup);

    test('the server takes one attempt per request, and reports it like always', async () => {
        const calls: string[] = [];
        const failingScope = scope().load({
            greeting: async () => {
                calls.push('call');
                throw Object.assign(new Error('backend exploded'), { retryable: true });
            },
        });
        const config = {
            scope: failingScope,
            component: ({ greeting }: { greeting: string }) => <div>{greeting}</div>,
            loading: () => <div>LOADING-SLOT</div>,
            error: ({ error }: { error: SourceError }) => <div>ERROR-SLOT: {error.code}</div>,
        };
        // Opted out vs. the default policy vs. an explicit one: server-side, all the same.
        const Plain = island({ ...config, retry: false as const });
        const Retrying = island({ ...config, retry: POLICY });

        const plain = await ssrRender(<Plain />, { onError: () => {} });
        const callsAfterPlain = calls.length;
        const retrying = await ssrRender(<Retrying />, { onError: () => {} });

        // Arming is commit-phase, and a server render has no commit — so the policy is
        // client-only without a single line spent enforcing it.
        expect(calls.length - callsAfterPlain).toBe(1);
        expect(retrying.html).toBe(plain.html);
        expect(retrying.errors.map((entry) => entry.error.code)).toEqual(['failed']);
        expect(JSON.stringify(retrying.data)).toBe(JSON.stringify(plain.data));
    });
});
