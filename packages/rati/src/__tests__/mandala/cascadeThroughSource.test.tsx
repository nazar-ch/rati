import { describe, test, expect, afterEach } from 'vite-plus/test';
import { render, screen, cleanup, act } from '@testing-library/react';
import type { FC } from 'react';
import { scope } from '../../scope/scope';
import { island } from '../../island/island';
import { useScopeControls, type ScopeControls } from '../../mandala/controls';
import { controllableSource, flush } from '../../testing';

/*
    A source key's value must reach the loads that read it — found while deciding whether the
    MF-02 command model's expected-value fixpoint could hold through a source key (it could
    not), and fixed. Effort record: docs/planned/mandala-fuzz/README.md §Findings 2026-07-15.

    What was wrong: a source key's value reached its dependents through
    `RefreshController.sourceReady()`, which emitted changed (so a `.provide()` factory
    rebuilt) but never called `markDependents` — so no later-level cell whose producer read
    the key was marked dirty, and nothing downstream re-ran. The promise path (`settled()`)
    and the sync path (`valueChanged()`) always did. The resolver now runs the same equals
    gate on each new source snapshot and calls `valueChanged` when it moves.
*/

const Loading: FC = () => <div>loading...</div>;

afterEach(cleanup);

function probeControls<S extends Parameters<typeof useScopeControls>[0]>(testScope: S) {
    const captured: { current: ScopeControls<S> | null } = { current: null };
    const Probe: FC = () => {
        captured.current = useScopeControls(testScope);
        return null;
    };
    return { captured, Probe };
}

describe('a cascade reaches through a source key', () => {
    // The documented promise (docs/current/public/reference.md §refresh): "a changed value re-runs
    // exactly the downstream loads whose producers read the key" — `b` being a source is not
    // an exemption. The cascade re-creates `b`; once its replacement settles on a new value,
    // `c` must re-run over it rather than keep a value derived from the old one.
    test('a changed refresh cascades through a re-created source to its readers', async () => {
        let aValue = 1;
        const testScope = scope()
            .load({ a: async () => aValue })
            .load({
                b: ({ a }: { a: number }) => {
                    const source = controllableSource<string>();
                    queueMicrotask(() => source.setReady(`b(a${a})`));
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
        await flush();
        expect(screen.getByText('c(b(a1))')).toBeTruthy();

        aValue = 2;
        await act(async () => {
            await captured.current!.refresh('a');
        });
        await flush(2);

        expect(screen.getByText('c(b(a2))')).toBeTruthy();
    });

    // The same rule with no refresh involved: a live source transitioning ready → ready is a
    // changed value like any other, so the loads that derived from it re-run. The waterfall
    // reads as a derivation, and now behaves as one — deriving in a dependent load is not
    // second-class next to deriving inside the source.
    test('a live source value change re-runs the loads that read it', async () => {
        const source = controllableSource<string>();
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
            source.setReady('v1');
        });
        expect(screen.getByText('b(v1)')).toBeTruthy();

        await act(async () => {
            source.setReady('v2');
        });
        await flush();

        expect(screen.getByText('b(v2)')).toBeTruthy();
    });
});
