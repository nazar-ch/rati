import { describe, test, expect, afterEach } from 'vite-plus/test';
import { render, screen, cleanup, act } from '@testing-library/react';
import type { FC } from 'react';
import { scope } from '../../scope/scope';
import { SourceSymbol, type Source, type SourceState } from '../../scope/source';
import { island } from '../../island/island';
import { useScopeControls, type ScopeControls } from '../../mandala/controls';

/*
    A cascade stops at a source key — two pins for a *known gap*, found while building the
    MF-02 command model (docs/planned/mandala-fuzz/README.md §Findings 2026-07-15).

    Root cause (one line): a source key's value reaches its dependents through
    `RefreshController.sourceReady()`, which calls `emitChanged` (so a `.provide()` factory
    rebuilds) but never `markDependents` — so no later-level cell whose producer read the
    key is marked dirty, and nothing downstream re-runs. `settled()` (the promise path) and
    `valueChanged()` (the sync path) both do call it.

    Both tests below assert the **contract**, so both are `test.fails`: they run, they are
    expected to fail, and the day the engine is fixed vitest reports "expected to fail but
    passed" — flip them to `test()` then. They deliberately do not pin today's behavior; a
    green test asserting `c` is stale would freeze the gap as if it were the promise.

    The fuzz spec arbitrary excludes source-kind keys from later levels' read-sets for
    exactly this reason (see fuzz/scopeHarness.tsx) — lift that restriction when these pass.
*/

const Loading: FC = () => <div>loading...</div>;

afterEach(cleanup);

type TestSource<T> = Source<T> & { set: (state: SourceState<T>) => void };

function testSource<T>(): TestSource<T> {
    let state: SourceState<T> = { status: 'pending' };
    const listeners = new Set<() => void>();
    return {
        [SourceSymbol]: true,
        getSnapshot: () => state,
        subscribe(onChange) {
            listeners.add(onChange);
            return () => {
                listeners.delete(onChange);
            };
        },
        attach: () => () => {},
        set: (next) => {
            state = next;
            for (const listener of listeners) listener();
        },
    };
}

function probeControls<S extends Parameters<typeof useScopeControls>[0]>(testScope: S) {
    const captured: { current: ScopeControls<S> | null } = { current: null };
    const Probe: FC = () => {
        captured.current = useScopeControls(testScope);
        return null;
    };
    return { captured, Probe };
}

describe('cascade through a source key (known gap)', () => {
    // The documented promise (docs/public/reference.md §refresh): "a changed value re-runs
    // exactly the downstream loads whose producers read the key". Here the cascade re-creates
    // the source `b` correctly — its rendered value does move a1 → a2 — but `c`, which reads
    // `b`, never re-runs, so a stale derived value survives quiesce.
    test.fails('a changed refresh cascades through a re-created source to its readers', async () => {
        let aValue = 1;
        const testScope = scope()
            .load({ a: async () => aValue })
            .load({
                b: ({ a }: { a: number }) => {
                    const source = testSource<string>();
                    queueMicrotask(() => source.set({ status: 'ready', value: `b(a${a})` }));
                    return source;
                },
            })
            .load({ c: ({ b }: { b: string }) => `c(${b})` });
        const { captured, Probe } = probeControls(testScope);
        const Island = island({
            scope: testScope,
            component: ({ c }: { c: string }) => (
                <div>
                    <span>{c}</span>
                    <Probe />
                </div>
            ),
            loading: Loading,
        });

        await act(async () => {
            render(<Island />);
        });
        await act(async () => {});
        expect(screen.getByText('c(b(a1))')).toBeTruthy();

        aValue = 2;
        await act(async () => {
            await captured.current!.refresh('a');
        });
        await act(async () => {});
        await act(async () => {});

        // Actual today: 'c(b(a1))' — b re-created and re-rendered as b(a2), c never re-ran.
        expect(screen.getByText('c(b(a2))')).toBeTruthy();
    });

    // The same root cause with no refresh involved: a live source transitioning ready → ready
    // leaves every load that derived from it stale. Whether this one is a gap or the intended
    // division of labor (derive *inside* the source — an observableSource/computed — rather
    // than in a dependent load) is the open question in the finding note; the waterfall reads
    // as a derivation either way, which is why it is pinned rather than assumed.
    test.fails('a live source value change re-runs the loads that read it', async () => {
        const source = testSource<string>();
        const testScope = scope()
            .load({ a: () => source })
            .load({ b: ({ a }: { a: string }) => `b(${a})` });
        const Island = island({
            scope: testScope,
            component: ({ b }: { b: string }) => <span>{b}</span>,
            loading: Loading,
        });

        await act(async () => {
            render(<Island />);
        });
        await act(async () => {
            source.set({ status: 'ready', value: 'v1' });
        });
        expect(screen.getByText('b(v1)')).toBeTruthy();

        await act(async () => {
            source.set({ status: 'ready', value: 'v2' });
        });
        await act(async () => {});

        // Actual today: 'b(v1)'.
        expect(screen.getByText('b(v2)')).toBeTruthy();
    });
});
