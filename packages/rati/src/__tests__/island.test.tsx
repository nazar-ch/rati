import { describe, test, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { observable, runInAction } from 'mobx';
import type { FC } from 'react';
import { createView, viewParam } from '../common/view';
import { NotAvailableError, SourceSymbol, type Source, type SourceState } from '../common/source';
import { createIsland } from '../experimental/island';

type TestEnv = { prefix: string };

const Loading: FC = () => <div>loading...</div>;

afterEach(cleanup);

// A hand-rolled source the test drives, logging attach/detach so lifetime is
// observable. Mirrors what a CRDT/REST adapter implements.
type TestSource<T> = Source<T> & {
    ready: (value: T) => void;
    fail: (code: string) => void;
    pend: () => void;
};

function testSource<T>(log: string[], id: string): TestSource<T> {
    const box = observable.box<SourceState<T>>({ status: 'pending' }, { deep: false });
    return {
        [SourceSymbol]: true,
        get state() {
            return box.get();
        },
        attach() {
            log.push(`attach:${id}`);
            return () => log.push(`detach:${id}`);
        },
        ready: (value) => act(() => runInAction(() => box.set({ status: 'ready', value }))),
        fail: (code) => act(() => runInAction(() => box.set({ status: 'error', error: { code } }))),
        pend: () => act(() => runInAction(() => box.set({ status: 'pending' }))),
    };
}

describe('createIsland', () => {
    test('shows loading, then the component with waterfall-resolved values', async () => {
        const Island = createIsland({
            useEnv: () => ({ prefix: 'env' }) as TestEnv,
            view: (env) =>
                createView
                    .chain({ id: viewParam<string>() })
                    .chain({ name: async ({ id }) => `${env.prefix}:${id}` })
                    .chain({ label: async ({ name }) => `[${name}]` }),
            component: ({ label }) => <div>ready {label}</div>,
            loading: Loading,
        });

        render(<Island id="a1" />);

        expect(screen.getByText('loading...')).toBeTruthy();
        expect(await screen.findByText('ready [env:a1]')).toBeTruthy();
    });

    test('routes a failed source to the error slot with the unified code', async () => {
        const Island = createIsland({
            useEnv: () => ({ prefix: 'env' }) as TestEnv,
            view: () =>
                createView.chain({ id: viewParam<string>() }).chain({
                    page: async (): Promise<string> => {
                        throw new NotAvailableError('no such page', { code: 'not-available' });
                    },
                }),
            component: () => <div>ready</div>,
            loading: Loading,
            error: ({ error }) => <div>error: {error.code}</div>,
        });

        render(<Island id="a1" />);

        expect(await screen.findByText('error: not-available')).toBeTruthy();
    });

    test('renders the error slot and retries successfully', async () => {
        let failures = 1;

        const Island = createIsland({
            useEnv: () => ({ prefix: 'env' }) as TestEnv,
            view: () =>
                createView.chain({ id: viewParam<string>() }).chain({
                    data: async ({ id }) => {
                        if (failures > 0) {
                            failures--;
                            throw new Error('boom');
                        }
                        return `data:${id}`;
                    },
                }),
            component: ({ data }) => <div>ready {data}</div>,
            loading: Loading,
            error: ({ retry }) => (
                <button type="button" onClick={retry}>
                    retry
                </button>
            ),
        });

        render(<Island id="a1" />);

        fireEvent.click(await screen.findByText('retry'));

        expect(await screen.findByText('ready data:a1')).toBeTruthy();
    });

    test('attaches sources and detaches them on unmount', async () => {
        const log: string[] = [];
        const res = testSource<{ id: string }>(log, 'res');

        const Island = createIsland({
            useEnv: () => ({ prefix: 'env' }) as TestEnv,
            view: () => createView.chain({ id: viewParam<string>() }).chain({ res: () => res }),
            component: ({ res: r }) => <div>ready {r.id}</div>,
            loading: Loading,
        });

        const { unmount } = render(<Island id="a1" />);
        expect(log).toContain('attach:res');

        res.ready({ id: 'a1' });
        await screen.findByText('ready a1');

        unmount();
        expect(log).toContain('detach:res');
    });

    test('builds a dependent level only once the prior source is ready', async () => {
        const log: string[] = [];
        const space = testSource<string>(log, 'space');
        const page = testSource<{ id: string }>(log, 'page');

        const Island = createIsland({
            useEnv: () => ({ prefix: 'env' }) as TestEnv,
            view: () =>
                createView
                    .chain({ id: viewParam<string>() })
                    .chain({ space: () => space })
                    .chain({ page: () => page }),
            component: ({ page: p }) => <div>ready {p.id}</div>,
            loading: Loading,
        });

        render(<Island id="a1" />);

        // The page level must not be built until `space` is ready.
        expect(log).toContain('attach:space');
        expect(log).not.toContain('attach:page');

        space.ready('s1');
        expect(log).toContain('attach:page');

        page.ready({ id: 'p1' });
        expect(await screen.findByText('ready p1')).toBeTruthy();
    });

    test('a ready source returning to pending drops back to loading', async () => {
        const log: string[] = [];
        const res = testSource<{ id: string }>(log, 'res');

        const Island = createIsland({
            useEnv: () => ({ prefix: 'env' }) as TestEnv,
            view: () => createView.chain({ id: viewParam<string>() }).chain({ res: () => res }),
            component: ({ res: r }) => <div>ready {r.id}</div>,
            loading: Loading,
        });

        render(<Island id="a1" />);
        res.ready({ id: 'a1' });
        await screen.findByText('ready a1');

        res.pend();
        expect(await screen.findByText('loading...')).toBeTruthy();
    });

    test('detaches the previous run and re-resolves when params change', async () => {
        const log: string[] = [];
        const sources = new Map<string, TestSource<{ id: string }>>();
        const sourceFor = (id: string) => {
            let source = sources.get(id);
            if (!source) {
                source = testSource<{ id: string }>(log, id);
                sources.set(id, source);
            }
            return source;
        };

        const Island = createIsland({
            useEnv: () => ({ prefix: 'env' }) as TestEnv,
            view: () =>
                createView
                    .chain({ id: viewParam<string>() })
                    .chain({ res: ({ id }) => sourceFor(id) }),
            component: ({ res }) => <div>ready {res.id}</div>,
            loading: Loading,
        });

        const { rerender } = render(<Island id="a1" />);
        sourceFor('a1').ready({ id: 'a1' });
        await screen.findByText('ready a1');

        rerender(<Island id="a2" />);
        expect(log).toContain('detach:a1');

        sourceFor('a2').ready({ id: 'a2' });
        expect(await screen.findByText('ready a2')).toBeTruthy();
    });
});
