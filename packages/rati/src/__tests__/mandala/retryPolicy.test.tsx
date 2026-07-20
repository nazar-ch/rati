import { describe, test, expect, afterEach, beforeEach, vi } from 'vite-plus/test';
import { act } from 'react';
import { scope, input } from '../../scope/scope';
import { NotAvailableError, type SourceError } from '../../scope/source';
import { island } from '../../island/island';
import { flush, renderIsland, ssrRender, cleanup } from '../../testing';

/*
    `retry` — the island takes another go at a failed resolution before it gives up.

    The shape the pins hold: an accepted failure is *not* an error state. The island keeps
    showing what it shows while resolving (the loading slot, or the kept run under
    `keepStale`), the error slot never mounts, and `retrying` says which attempt is in
    flight. Only a spent budget — or an error that was never a fault to begin with
    (`not-available`) — puts the error slot up, and the manual `retry` on it starts over.

    The cadence is exponential from `backoffMs`, so `{ count: 2, backoffMs: 500 }` means one
    attempt at 500ms and one at 1500ms. Fake timers make that a step rather than a wait.
*/

const BACKOFF = 500;
const POLICY = { count: 2, backoffMs: BACKOFF };

type Attempts = { calls: string[]; failing: boolean };

/**
 * A scope whose one load fails while `attempts.failing` is set, recording every call. The
 * `id` input is there so the param-change pin has something to change.
 */
function flakyConfig(attempts: Attempts, extra = {}) {
    return {
        scope: scope({ id: input<string>() }).load({
            label: async ({ id }: { id: string }) => {
                attempts.calls.push(id);
                if (attempts.failing) throw new Error('backend exploded');
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
    });
    afterEach(() => {
        cleanup();
        vi.useRealTimers();
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

        // Straight to the slot the user is owed: one call, no backoff, no delay.
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

    test('count: 0 is the absent option — the error slot, on the spot', async () => {
        const attempts: Attempts = { calls: [], failing: true };
        const before = vi.getTimerCount();
        const handle = await renderIsland(
            flakyConfig(attempts, { retry: { count: 0, backoffMs: BACKOFF } }),
            { props: { id: 'a' } },
        );

        expect(handle.slot()).toBe('error');
        expect(attempts.calls).toHaveLength(1);
        expect(vi.getTimerCount()).toBe(before);
    });

    test('an island without the option is untouched', async () => {
        const attempts: Attempts = { calls: [], failing: true };
        const before = vi.getTimerCount();
        const handle = await renderIsland(flakyConfig(attempts, { retry: undefined }), {
            props: { id: 'a' },
        });

        expect(handle.slot()).toBe('error');
        expect(handle.controls().retrying).toBe(0);
        expect(vi.getTimerCount()).toBe(before);
    });
});

describe('retry — SSR', () => {
    afterEach(cleanup);

    test('the server takes one attempt per request, and reports it like always', async () => {
        const calls: string[] = [];
        const failingScope = scope().load({
            greeting: async () => {
                calls.push('call');
                throw new Error('backend exploded');
            },
        });
        const config = {
            scope: failingScope,
            component: ({ greeting }: { greeting: string }) => <div>{greeting}</div>,
            loading: () => <div>LOADING-SLOT</div>,
            error: ({ error }: { error: SourceError }) => <div>ERROR-SLOT: {error.code}</div>,
        };
        const Plain = island(config);
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
