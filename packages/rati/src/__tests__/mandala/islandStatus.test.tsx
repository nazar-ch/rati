import { describe, test, expect, afterEach } from 'vite-plus/test';
import { Component, type ReactNode } from 'react';
import { scope, input } from '../../scope/scope';
import { useScopeControls } from '../../mandala/controls';
import { controllableSource, deferred, flush, renderIsland, cleanup } from '../../testing';

afterEach(cleanup);

/*
    The status surface on `useScopeControls` — `phase`, `isStale`, `retry`.

    `phase` is the island's *aggregate* phase, which in practice means "which slot is on
    screen". No single piece of bookkeeping knows that: a level can be suspended on a
    promise, pending on a source, or thrown to the boundary, and in none of those cases does
    the mandala itself re-render. So whatever renders reports, and these pins walk a full
    pending → ready → stale → ready → error cycle to hold that reporting honest.
*/

// The harness reads controls from a probe rendered in *every* slot, so `handle.controls()`
// works whichever one is up — including the error slot.
function statusOf(handle: { controls: () => { phase: string; isStale: boolean } }) {
    const { phase, isStale } = handle.controls();
    return { phase, isStale };
}

describe('phase', () => {
    test('walks pending → ready → stale → ready → error', async () => {
        const gates = new Map<string, ReturnType<typeof deferred<string>>>();
        const config = {
            scope: scope({ id: input<string>() }).load({
                label: ({ id }) => {
                    const gate = deferred<string>();
                    gates.set(id, gate);
                    return gate.promise;
                },
            }),
            component: ({ label }: { label: string }) => <div>{label}</div>,
            loading: () => <div>loading slot</div>,
            error: () => <div>error slot</div>,
            keepStale: true,
        };

        const handle = await renderIsland(config, { props: { id: 'a' } });
        expect(statusOf(handle)).toEqual({ phase: 'loading', isStale: false });

        gates.get('a')!.resolve('A');
        await flush();
        expect(statusOf(handle)).toEqual({ phase: 'ready', isStale: false });

        await handle.rerender({ id: 'b' });
        // Content is on screen, so 'ready' — `isStale` is what says whose content.
        expect(statusOf(handle)).toEqual({ phase: 'ready', isStale: true });

        gates.get('b')!.resolve('B');
        await flush();
        expect(statusOf(handle)).toEqual({ phase: 'ready', isStale: false });

        await handle.rerender({ id: 'c' });
        expect(statusOf(handle)).toEqual({ phase: 'ready', isStale: true });
        gates.get('c')!.reject(new Error('boom'));
        await flush();
        // The error slot replaced the stale content: no longer stale, and not ready.
        expect(statusOf(handle)).toEqual({ phase: 'error', isStale: false });
    });

    test('is meaningful without keepStale — it just never goes stale', async () => {
        const gates = new Map<string, ReturnType<typeof deferred<string>>>();
        const config = {
            scope: scope({ id: input<string>() }).load({
                label: ({ id }) => {
                    const gate = deferred<string>();
                    gates.set(id, gate);
                    return gate.promise;
                },
            }),
            component: ({ label }: { label: string }) => <div>{label}</div>,
            loading: () => <div>loading slot</div>,
        };

        const handle = await renderIsland(config, { props: { id: 'a' } });
        gates.get('a')!.resolve('A');
        await flush();
        expect(statusOf(handle)).toEqual({ phase: 'ready', isStale: false });

        await handle.rerender({ id: 'b' });
        expect(statusOf(handle)).toEqual({ phase: 'loading', isStale: false });

        gates.get('b')!.resolve('B');
        await flush();
        expect(statusOf(handle)).toEqual({ phase: 'ready', isStale: false });
    });

    test('a source dropping to pending reports loading again', async () => {
        const source = controllableSource<string>({ initial: 'live' });
        const handle = await renderIsland({
            scope: scope().load({ live: () => source }),
            component: ({ live }: { live: string }) => <div>{live}</div>,
            loading: () => <div>loading slot</div>,
        });
        expect(statusOf(handle)).toEqual({ phase: 'ready', isStale: false });

        source.setPending();
        await flush();
        expect(statusOf(handle)).toEqual({ phase: 'loading', isStale: false });

        source.setReady('back');
        await flush();
        expect(statusOf(handle)).toEqual({ phase: 'ready', isStale: false });
    });

    test('the subtree reads the phase its own render produced, not the previous one', async () => {
        const seen: Array<{ phase: string; isStale: boolean }> = [];
        const gates = new Map<string, ReturnType<typeof deferred<string>>>();
        const testScope = scope({ id: input<string>() }).load({
            label: ({ id }) => {
                const gate = deferred<string>();
                gates.set(id, gate);
                return gate.promise;
            },
        });

        function Body({ label }: { label: string }) {
            const { phase, isStale } = useScopeControls(testScope);
            seen.push({ phase, isStale });
            return <div>{label}</div>;
        }

        const handle = await renderIsland(
            {
                scope: testScope,
                component: Body,
                loading: () => <div>loading slot</div>,
                keepStale: true,
            },
            { props: { id: 'a' } },
        );
        gates.get('a')!.resolve('A');
        await flush();
        seen.length = 0;

        await handle.rerender({ id: 'b' });

        // The kept run reports before rendering the component below it, so the very first
        // stale render already knows it is stale — no undimmed frame to flash through.
        expect(seen[0]).toEqual({ phase: 'ready', isStale: true });
    });
});

describe('retry', () => {
    test('re-resolves from anywhere in the subtree, not just the error slot', async () => {
        let runs = 0;
        const gates: Array<ReturnType<typeof deferred<string>>> = [];
        const testScope = scope().load({
            label: () => {
                runs++;
                const gate = deferred<string>();
                gates.push(gate);
                return gate.promise;
            },
        });

        const handle = await renderIsland({
            scope: testScope,
            component: ({ label }: { label: string }) => <div>{label}</div>,
            loading: () => <div>loading slot</div>,
        });
        gates[0]!.resolve('first');
        await flush();
        expect(runs).toBe(1);

        handle.controls().retry();
        await flush();

        expect(runs).toBe(2);
        gates[1]!.resolve('second');
        await flush();
        expect(handle.text()).toBe('second');
    });
});

describe('the framework-shaped errors still fire', () => {
    // Catches the hook's throw so the assertion can read its message from the DOM.
    class Catcher extends Component<{ children: ReactNode }, { message: string | null }> {
        override state = { message: null as string | null };
        static getDerivedStateFromError(error: unknown) {
            return { message: error instanceof Error ? error.message : String(error) };
        }
        override render() {
            return this.state.message ?? this.props.children;
        }
    }

    test('the two messages survive the widened surface', async () => {
        const neverMounted = scope().load({ value: async () => 1 });
        const mounted = scope().load({ value: async () => 1 });

        function ReadsUnregistered() {
            useScopeControls(neverMounted);
            return null;
        }
        function ReadsOutside() {
            useScopeControls(mounted);
            return null;
        }

        // No island was ever built from this scope — the misuse message.
        const orphan = await renderIsland(
            {
                scope: mounted,
                component: () => <ReadsUnregistered />,
                loading: () => <div>loading</div>,
            },
            { wrapper: Catcher },
        );
        await flush();
        expect(orphan.container.textContent).toContain('no island uses this scope');

        // An island for the scope exists, but this component is not inside one.
        const outside = await renderIsland(
            {
                scope: scope().load({ other: async () => 1 }),
                component: () => <div>content</div>,
                loading: () => <div>loading</div>,
            },
            {
                wrapper: ({ children }) => (
                    <Catcher>
                        {children}
                        <ReadsOutside />
                    </Catcher>
                ),
            },
        );
        await flush();
        expect(outside.container.textContent).toContain(
            'no island for this scope is above the current component',
        );
    });
});
