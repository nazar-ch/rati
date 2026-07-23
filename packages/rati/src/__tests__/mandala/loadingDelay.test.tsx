import { describe, test, expect, afterEach, beforeEach, vi } from 'vite-plus/test';
import { act } from 'react';
import { scope, input } from '../../scope/scope';
import { island } from '../../island/island';
import {
    controllableSource,
    deferred,
    flush,
    renderIsland,
    ssrRender,
    cleanup,
} from '../../testing';

/*
    `loadingDelayMs` — the island holds its loading slot back, so a resolution that settles
    in tens of milliseconds never flashes one.

    Two halves, one deadline. A first load has nothing to show, so it shows nothing; a
    re-resolve borrows `keepStale`'s mechanism and shows the previous content — for the
    length of the window only, which is what separates the option from `keepStale` itself.
    The pins below walk both, plus the two edges the deadline is measured by: it counts a
    stretch *without content* (a superseding re-resolve doesn't push it out, and never blanks
    a slot that is already up), and it is inert wherever there are no timers to run at all —
    the server and the hydration pass.
*/

const DELAY = 200;

// A scope whose one load is a gate the test opens by hand, so the delay window has a
// beginning and an end the assertions can sit between.
function gatedConfig(gates: Map<string, ReturnType<typeof deferred<string>>>, extra = {}) {
    return {
        scope: scope({ id: input<string>() }).load({
            label: ({ id }) => {
                const gate = deferred<string>();
                gates.set(id, gate);
                return gate.promise;
            },
        }),
        component: ({ label }: { label: string }) => <div>{label}</div>,
        loading: () => <div>loading slot</div>,
        loadingDelayMs: DELAY,
        ...extra,
    };
}

describe('loadingDelayMs — the client', () => {
    beforeEach(() => {
        // Fake timers so the deadline is a step, not a wait. Vitest leaves `queueMicrotask`
        // real, which is what the gate's notify and React's own work ride on.
        vi.useFakeTimers();
    });
    afterEach(() => {
        cleanup();
        vi.useRealTimers();
    });

    /** Step past the deadline and let the re-render it triggers land. */
    async function passDeadline(): Promise<void> {
        await act(async () => {
            vi.advanceTimersByTime(DELAY + 1);
        });
        await flush();
    }

    test('a resolution that beats the deadline renders content with no slot in between', async () => {
        let slotRenders = 0;
        const handle = await renderIsland({
            scope: scope().load({ label: async () => 'fast' }),
            component: ({ label }: { label: string }) => <div>{label}</div>,
            loading: () => {
                slotRenders++;
                return <div>loading slot</div>;
            },
            loadingDelayMs: DELAY,
        });

        expect(handle.slot()).toBe('content');
        // The whole point: the slot was never rendered, not rendered-and-replaced.
        expect(slotRenders).toBe(0);
        // ...and the countdown it beat is gone with it.
        expect(vi.getTimerCount()).toBe(0);
    });

    test('a slow first load renders nothing, then the slot at the deadline, then content', async () => {
        const gates = new Map<string, ReturnType<typeof deferred<string>>>();
        const handle = await renderIsland(gatedConfig(gates), { props: { id: 'a' } });

        // Nothing at all — not the slot, and not a placeholder standing in for it.
        expect(handle.container.textContent).toBe('');

        await passDeadline();
        expect(handle.slot()).toBe('loading');

        gates.get('a')!.resolve('page A');
        await flush();
        expect(handle.slot()).toBe('content');
        expect(handle.text()).toBe('page A');
    });

    test('a re-resolve keeps the previous content until the deadline, then shows the slot', async () => {
        const gates = new Map<string, ReturnType<typeof deferred<string>>>();
        const handle = await renderIsland(gatedConfig(gates), { props: { id: 'a' } });
        gates.get('a')!.resolve('page A');
        await flush();

        await handle.rerender({ id: 'b' });

        // `keepStale`'s mechanism, borrowed — the previous run is still on screen.
        expect(handle.slot()).toBe('content');
        expect(handle.text()).toBe('page A');

        await passDeadline();
        // ...and only borrowed: past the deadline the island admits it is loading.
        expect(handle.slot()).toBe('loading');

        gates.get('b')!.resolve('page B');
        await flush();
        expect(handle.text()).toBe('page B');
    });

    test('a full refresh() keeps the content the same way a param change does', async () => {
        const gates: Array<ReturnType<typeof deferred<string>>> = [];
        const handle = await renderIsland({
            scope: scope().load({
                label: () => {
                    const gate = deferred<string>();
                    gates.push(gate);
                    return gate.promise;
                },
            }),
            component: ({ label }: { label: string }) => <div>{label}</div>,
            loading: () => <div>loading slot</div>,
            loadingDelayMs: DELAY,
        });
        gates[0]!.resolve('first');
        await flush();

        await handle.controls().refresh();
        await flush();
        expect(handle.text()).toBe('first');

        await passDeadline();
        expect(handle.slot()).toBe('loading');

        gates[1]!.resolve('second');
        await flush();
        expect(handle.text()).toBe('second');
    });

    test('the run kept for the window is released when the deadline passes', async () => {
        const log: string[] = [];
        const gates = new Map<string, ReturnType<typeof deferred<string>>>();
        const handle = await renderIsland(
            {
                scope: scope({ id: input<string>() }).load({
                    label: ({ id }) => {
                        const gate = deferred<string>();
                        gates.set(id, gate);
                        return gate.promise;
                    },
                    live: ({ id }) =>
                        controllableSource<string>({
                            initial: `live ${id}`,
                            onDetach: () => log.push(`detach ${id}`),
                        }),
                }),
                component: ({ label }: { label: string; live: string }) => <div>{label}</div>,
                loading: () => <div>loading slot</div>,
                loadingDelayMs: DELAY,
            },
            { props: { id: 'a' } },
        );
        gates.get('a')!.resolve('page A');
        await flush();

        await handle.rerender({ id: 'b' });
        // Still on screen, so still whole: sources attached, nothing discarded.
        expect(log).toEqual([]);

        await passDeadline();
        // Off screen is the end of it — a borrowed run is not a leaked one.
        expect(log).toEqual(['detach a']);
    });

    test('with keepStale the slot appears only for a slow first load', async () => {
        let slotRenders = 0;
        const gates = new Map<string, ReturnType<typeof deferred<string>>>();
        const config = gatedConfig(gates, {
            keepStale: true,
            loading: () => {
                slotRenders++;
                return <div>loading slot</div>;
            },
        });

        const handle = await renderIsland(config, { props: { id: 'a' } });
        // First load, and slow: nothing until the deadline, then the slot.
        expect(handle.container.textContent).toBe('');
        await passDeadline();
        expect(handle.slot()).toBe('loading');
        expect(slotRenders).toBeGreaterThan(0);

        gates.get('a')!.resolve('page A');
        await flush();
        const afterFirstLoad = slotRenders;

        await handle.rerender({ id: 'b' });
        await passDeadline();

        // The composed contract: past the deadline `keepStale` still holds the content, so
        // the slot never comes back for a re-resolve.
        expect(handle.slot()).toBe('content');
        expect(handle.text()).toBe('page A');
        expect(slotRenders).toBe(afterFirstLoad);

        gates.get('b')!.resolve('page B');
        await flush();
        expect(handle.text()).toBe('page B');
    });

    test('a superseding re-resolve does not push the deadline out, or blank a slot already up', async () => {
        const gates = new Map<string, ReturnType<typeof deferred<string>>>();
        const handle = await renderIsland(gatedConfig(gates), { props: { id: 'a' } });

        await passDeadline();
        expect(handle.slot()).toBe('loading');

        await handle.rerender({ id: 'b' });
        // The deadline measures a stretch without content, and this one has been running
        // since 'a' — re-arming it here would blank the slot the user is already looking at.
        expect(handle.slot()).toBe('loading');

        gates.get('b')!.resolve('page B');
        await flush();
        expect(handle.text()).toBe('page B');
    });

    test('the status surface reports the window: ready+stale, then loading', async () => {
        const gates = new Map<string, ReturnType<typeof deferred<string>>>();
        const handle = await renderIsland(gatedConfig(gates), { props: { id: 'a' } });
        gates.get('a')!.resolve('page A');
        await flush();

        await handle.rerender({ id: 'b' });
        // Content is on screen and it is the previous resolution's — the same reading
        // `keepStale` gets, for as long as the window lasts.
        expect(handle.controls().phase).toBe('ready');
        expect(handle.controls().isStale).toBe(true);

        await passDeadline();
        expect(handle.controls().phase).toBe('loading');
        expect(handle.controls().isStale).toBe(false);
    });

    test('unmounting inside the window leaves no timer behind', async () => {
        const gates = new Map<string, ReturnType<typeof deferred<string>>>();
        const before = vi.getTimerCount();

        const handle = await renderIsland(gatedConfig(gates), { props: { id: 'a' } });
        expect(vi.getTimerCount()).toBe(before + 1);

        handle.unmount();
        expect(vi.getTimerCount()).toBe(before);
    });

    test('0 is the absent option: the slot renders on the spot, and nothing is armed', async () => {
        const gates = new Map<string, ReturnType<typeof deferred<string>>>();
        const before = vi.getTimerCount();

        const handle = await renderIsland(gatedConfig(gates, { loadingDelayMs: 0 }), {
            props: { id: 'a' },
        });

        expect(handle.slot()).toBe('loading');
        expect(vi.getTimerCount()).toBe(before);

        // ...and no run is kept either: a param change blanks to the slot, as without it.
        gates.get('a')!.resolve('page A');
        await flush();
        await handle.rerender({ id: 'b' });
        expect(handle.slot()).toBe('loading');
    });
});

describe('loadingDelayMs — SSR', () => {
    afterEach(cleanup);

    test('leaves the dehydrated payload and HTML untouched', async () => {
        const greetingScope = scope().load({ greeting: async () => 'hello' });
        const Plain = island({
            scope: greetingScope,
            component: ({ greeting }) => <div>{greeting}</div>,
            loading: () => <div>loading slot</div>,
        });
        const Delayed = island({
            scope: greetingScope,
            component: ({ greeting }) => <div>{greeting}</div>,
            loading: () => <div>loading slot</div>,
            loadingDelayMs: DELAY,
        });

        const plain = await ssrRender(<Plain />);
        const delayed = await ssrRender(<Delayed />);

        // The server waits for the resolution regardless — there is no slot to delay.
        expect(delayed.html).toBe(plain.html);
        expect(JSON.stringify(delayed.data)).toBe(JSON.stringify(plain.data));
        expect(JSON.stringify(delayed.seeds)).toBe(JSON.stringify(plain.seeds));
    });

    test('a slot that belongs in the HTML is rendered, and not taken back on hydration', async () => {
        const gate = deferred<string>();
        // `ssr: false` is the island whose slot *is* its server output — the case a delay
        // could quietly blank, on the server and again on the first post-hydration render.
        const Island = island({
            scope: scope().load({ note: () => gate.promise }),
            component: ({ note }) => <div>{note}</div>,
            loading: () => <div>loading slot</div>,
            ssr: false,
            loadingDelayMs: DELAY,
        });

        const server = await ssrRender(<Island />);
        expect(server.html).toContain('loading slot');

        // Throws on any recoverable error, so a clean hydrate is the no-mismatch assertion.
        const client = await server.hydrate();
        await flush();
        // The delay's client-side window opened on this island's first render like any
        // other's — but the slot it would hold back is already on screen, and blanking what
        // the server shipped is the flash the option exists to prevent.
        expect(client.text()).toBe('loading slot');

        gate.resolve('resolved on the client');
        await flush();
        expect(client.text()).toBe('resolved on the client');
    });
});
