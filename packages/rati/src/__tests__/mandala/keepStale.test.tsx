import { describe, test, expect, afterEach } from 'vite-plus/test';
import { scope, input } from '../../scope/scope';
import { island } from '../../island/island';
import { useScope } from '../../mandala/channel';
import {
    controllableSource,
    deferred,
    flush,
    renderIsland,
    ssrRender,
    cleanup,
} from '../../testing';

afterEach(cleanup);

/*
    `keepStale` — the island keeps its last committed output on screen while the next one
    resolves, instead of blanking to the loading slot.

    What the engine actually keeps is the *run*, not a copy of its props: its buckets stay
    out of the discard path, so its sources stay attached and its `.provide()` value stays
    alive and published until the successor commits. The pins below are as much about that
    lifetime as about the pixels — a snapshot rendered over torn-down resources would pass
    the first two tests and fail the rest.
*/

// A scope whose one load is a gate the test opens by hand, so the stale window has a
// beginning and an end the assertions can sit between.
function gatedConfig(gates: Map<string, ReturnType<typeof deferred<string>>>) {
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
        keepStale: true,
    };
}

describe('keepStale — the stale window', () => {
    test('a param change keeps the previous content instead of the loading slot', async () => {
        const gates = new Map<string, ReturnType<typeof deferred<string>>>();
        const config = gatedConfig(gates);

        const handle = await renderIsland(config, { props: { id: 'a' } });
        gates.get('a')!.resolve('page A');
        await flush();
        expect(handle.slot()).toBe('content');
        expect(handle.text()).toBe('page A');

        await handle.rerender({ id: 'b' });

        // The whole point: B is resolving, and A is still on screen.
        expect(handle.slot()).toBe('content');
        expect(handle.text()).toBe('page A');

        gates.get('b')!.resolve('page B');
        await flush();
        expect(handle.text()).toBe('page B');
    });

    test('the first load has nothing to keep and shows the loading slot', async () => {
        const gates = new Map<string, ReturnType<typeof deferred<string>>>();
        const handle = await renderIsland(gatedConfig(gates), { props: { id: 'a' } });

        expect(handle.slot()).toBe('loading');
        gates.get('a')!.resolve('page A');
        await flush();
        expect(handle.slot()).toBe('content');
    });

    test('without keepStale the same change blanks to the loading slot', async () => {
        const gates = new Map<string, ReturnType<typeof deferred<string>>>();
        const { keepStale: _omitted, ...config } = gatedConfig(gates);

        const handle = await renderIsland(config, { props: { id: 'a' } });
        gates.get('a')!.resolve('page A');
        await flush();

        await handle.rerender({ id: 'b' });

        expect(handle.slot()).toBe('loading');
    });

    test('a second param change mid-window keeps showing the original, not the half-built one', async () => {
        const gates = new Map<string, ReturnType<typeof deferred<string>>>();
        const handle = await renderIsland(gatedConfig(gates), { props: { id: 'a' } });
        gates.get('a')!.resolve('page A');
        await flush();

        await handle.rerender({ id: 'b' });
        await handle.rerender({ id: 'c' });

        // B never reached the screen, so it is not a baseline — A still is.
        expect(handle.text()).toBe('page A');

        gates.get('c')!.resolve('page C');
        await flush();
        expect(handle.text()).toBe('page C');
    });

    test('a full refresh() keeps the content the same way a param change does', async () => {
        const gates: Array<ReturnType<typeof deferred<string>>> = [];
        const config = {
            scope: scope().load({
                label: () => {
                    const gate = deferred<string>();
                    gates.push(gate);
                    return gate.promise;
                },
            }),
            component: ({ label }: { label: string }) => <div>{label}</div>,
            loading: () => <div>loading slot</div>,
            keepStale: true,
        };
        const handle = await renderIsland(config);
        gates[0]!.resolve('first');
        await flush();

        await handle.controls().refresh();
        await flush();

        expect(handle.slot()).toBe('content');
        expect(handle.text()).toBe('first');

        gates[1]!.resolve('second');
        await flush();
        expect(handle.text()).toBe('second');
    });

    test('an error during the stale window shows the error slot, not stale content', async () => {
        const gates = new Map<string, ReturnType<typeof deferred<string>>>();
        const handle = await renderIsland(
            { ...gatedConfig(gates), error: () => <div>failed</div> },
            { props: { id: 'a' } },
        );
        gates.get('a')!.resolve('page A');
        await flush();

        await handle.rerender({ id: 'b' });
        expect(handle.text()).toBe('page A');

        gates.get('b')!.reject(new Error('boom'));
        await flush();

        // Honest failure beats stale content passing for current.
        expect(handle.slot()).toBe('error');
    });
});

describe('keepStale — what stays alive while stale', () => {
    test("the kept run's sources stay attached until the successor commits", async () => {
        const log: string[] = [];
        const gates = new Map<string, ReturnType<typeof deferred<string>>>();
        const config = {
            scope: scope({ id: input<string>() }).load({
                label: ({ id }) => {
                    const gate = deferred<string>();
                    gates.set(id, gate);
                    return gate.promise;
                },
                live: ({ id }) =>
                    controllableSource<string>({
                        initial: `live ${id}`,
                        onAttach: () => log.push(`attach ${id}`),
                        onDetach: () => log.push(`detach ${id}`),
                    }),
            }),
            component: ({ label, live }: { label: string; live: string }) => (
                <div>
                    {label} · {live}
                </div>
            ),
            loading: () => <div>loading slot</div>,
            keepStale: true,
        };

        const handle = await renderIsland(config, { props: { id: 'a' } });
        gates.get('a')!.resolve('page A');
        await flush();
        expect(log).toEqual(['attach a']);

        await handle.rerender({ id: 'b' });

        // A is still rendering, so its source is still attached — the stale content is a
        // live run held on screen, not a re-render over a detached one. (B's own source
        // hasn't attached yet: its level is suspended on `label`, and a suspended level
        // commits nothing.)
        expect(log).toEqual(['attach a']);

        gates.get('b')!.resolve('page B');
        await flush();

        // The swap is what releases it — and only after B is attached, so a source shared
        // by both runs is never torn down and rebuilt across the window.
        expect(log).toEqual(['attach a', 'attach b', 'detach a']);
    });

    test('a .provide() value stays alive and published through the window, and disposes at the swap', async () => {
        const log: string[] = [];
        const gates = new Map<string, ReturnType<typeof deferred<string>>>();
        const provided = scope({ id: input<string>() })
            .load({
                label: ({ id }) => {
                    const gate = deferred<string>();
                    gates.set(id, gate);
                    return gate.promise;
                },
            })
            .provide(({ label }) => {
                log.push(`build ${label}`);
                return {
                    title: `store(${label})`,
                    [Symbol.dispose]: () => log.push(`dispose ${label}`),
                };
            });

        // Reads the channel, so it fails loudly if the stale window publishes nothing —
        // the case a props-only snapshot could not have covered.
        function Readout() {
            const store = useScope(provided);
            return <span>{store.title}</span>;
        }

        const handle = await renderIsland(
            {
                scope: provided,
                component: () => <Readout />,
                loading: () => <div>loading slot</div>,
                keepStale: true,
            },
            { props: { id: 'a' } },
        );
        gates.get('a')!.resolve('A');
        await flush();
        expect(handle.text()).toBe('store(A)');
        expect(log).toEqual(['build A']);

        await handle.rerender({ id: 'b' });

        // Still published, still undisposed.
        expect(handle.text()).toBe('store(A)');
        expect(log).toEqual(['build A']);

        gates.get('b')!.resolve('B');
        await flush();

        expect(handle.text()).toBe('store(B)');
        // Built before the old one let go, and disposed exactly once.
        expect(log).toEqual(['build A', 'build B', 'dispose A']);
    });

    test('unmounting mid-window releases the kept run too', async () => {
        const log: string[] = [];
        const gates = new Map<string, ReturnType<typeof deferred<string>>>();
        const config = {
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
            keepStale: true,
        };

        const handle = await renderIsland(config, { props: { id: 'a' } });
        gates.get('a')!.resolve('page A');
        await flush();
        await handle.rerender({ id: 'b' });

        handle.unmount();
        await flush();

        // The kept run is not a leak the island can walk away from: its source detaches at
        // unmount even though no swap ever came to release it. (B's never attached — its
        // level was still suspended when the island went away.)
        expect(log).toEqual(['detach a']);
    });

    test('a source dropping back to pending still shows the loading slot', async () => {
        const source = controllableSource<string>({ initial: 'live' });
        const handle = await renderIsland({
            scope: scope().load({ live: () => source }),
            component: ({ live }: { live: string }) => <div>{live}</div>,
            loading: () => <div>loading slot</div>,
            keepStale: true,
        });
        expect(handle.slot()).toBe('content');

        source.setPending();
        await flush();

        // Not a re-resolution: a live source going pending is the source's own contract,
        // and `keepStale` does not paper over it.
        expect(handle.slot()).toBe('loading');
    });
});

describe('keepStale — the props the subtree sees', () => {
    test('the kept content renders the previous inputs, and swaps on commit', async () => {
        const seen: string[] = [];
        const gates = new Map<string, ReturnType<typeof deferred<string>>>();
        const config = {
            scope: scope({ id: input<string>() }).load({
                label: ({ id }) => {
                    const gate = deferred<string>();
                    gates.set(id, gate);
                    return gate.promise;
                },
            }),
            component: ({ id, label }: { id: string; label: string }) => {
                seen.push(`${id}/${label}`);
                return (
                    <div>
                        {id}/{label}
                    </div>
                );
            },
            loading: () => <div>loading slot</div>,
            keepStale: true,
        };

        const handle = await renderIsland(config, { props: { id: 'a' } });
        gates.get('a')!.resolve('A');
        await flush();

        await handle.rerender({ id: 'b' });

        // The documented consequence: old props under a new URL, until the swap.
        expect(handle.text()).toBe('a/A');

        gates.get('b')!.resolve('B');
        await flush();
        expect(handle.text()).toBe('b/B');
        expect(seen).toEqual(['a/A', 'a/A', 'b/B']);
    });

    test('no load re-runs to render the kept content', async () => {
        let runs = 0;
        const gates = new Map<string, ReturnType<typeof deferred<string>>>();
        const config = {
            scope: scope({ id: input<string>() }).load({
                label: ({ id }) => {
                    runs++;
                    const gate = deferred<string>();
                    gates.set(id, gate);
                    return gate.promise;
                },
            }),
            component: ({ label }: { label: string }) => <div>{label}</div>,
            loading: () => <div>loading slot</div>,
            keepStale: true,
        };

        const handle = await renderIsland(config, { props: { id: 'a' } });
        gates.get('a')!.resolve('A');
        await flush();
        expect(runs).toBe(1);

        await handle.rerender({ id: 'b' });

        // The stale window renders a finished run; only B's own load started.
        expect(runs).toBe(2);
    });
});

describe('keepStale — SSR', () => {
    test('leaves the dehydrated payload and HTML untouched', async () => {
        const greetingScope = scope().load({ greeting: async () => 'hello' });
        const Plain = island({
            scope: greetingScope,
            component: ({ greeting }) => <div>{greeting}</div>,
            loading: () => <div>loading slot</div>,
        });
        const Stale = island({
            scope: greetingScope,
            component: ({ greeting }) => <div>{greeting}</div>,
            loading: () => <div>loading slot</div>,
            keepStale: true,
        });

        const plain = await ssrRender(<Plain />);
        const stale = await ssrRender(<Stale />);

        // The server never re-resolves, so the option has nothing to do there.
        expect(stale.html).toBe(plain.html);
        expect(JSON.stringify(stale.data)).toBe(JSON.stringify(plain.data));
        expect(JSON.stringify(stale.seeds)).toBe(JSON.stringify(plain.seeds));
    });
});
