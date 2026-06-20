import { describe, test, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import type { FC } from 'react';
import { createView, viewParam } from '../common/view';
import { createIsland, NotAvailableError } from '../experimental/island';

type TestEnv = { prefix: string };

const Loading: FC = () => <div>loading...</div>;

afterEach(cleanup);

function disposable(id: string, log: string[]) {
    return {
        id,
        [Symbol.dispose]: () => log.push(`disposed:${id}`),
    };
}

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((r) => {
        resolve = r;
    });
    return { promise, resolve };
}

describe('createIsland', () => {
    test('shows loading, then the component with waterfall-resolved props', async () => {
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

    test('routes NotAvailableError to the notAvailable slot and disposes earlier levels', async () => {
        const log: string[] = [];

        const Island = createIsland({
            useEnv: () => ({ prefix: 'env' }) as TestEnv,
            view: () =>
                createView
                    .chain({ id: viewParam<string>() })
                    .chain({ res: async ({ id }) => disposable(id, log) })
                    .chain({
                        page: async (): Promise<string> => {
                            throw new NotAvailableError('no such page', { code: '404' });
                        },
                    }),
            component: () => <div>ready</div>,
            loading: Loading,
            notAvailable: ({ error }) => <div>not available: {error.code}</div>,
        });

        render(<Island id="a1" />);

        expect(await screen.findByText('not available: 404')).toBeTruthy();
        // The grabbed resource from the level before the failure was released
        expect(log).toEqual(['disposed:a1']);
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

    test('disposes owned props on unmount', async () => {
        const log: string[] = [];

        const Island = createIsland({
            useEnv: () => ({ prefix: 'env' }) as TestEnv,
            view: () =>
                createView
                    .chain({ id: viewParam<string>() })
                    .chain({ res: async ({ id }) => disposable(id, log) }),
            component: ({ res }) => <div>ready {res.id}</div>,
            loading: Loading,
        });

        const { unmount } = render(<Island id="a1" />);
        await screen.findByText('ready a1');
        expect(log).toEqual([]);

        unmount();
        expect(log).toEqual(['disposed:a1']);
    });

    test('disposes previous props and re-resolves when params change', async () => {
        const log: string[] = [];

        const Island = createIsland({
            useEnv: () => ({ prefix: 'env' }) as TestEnv,
            view: () =>
                createView
                    .chain({ id: viewParam<string>() })
                    .chain({ res: async ({ id }) => disposable(id, log) }),
            component: ({ res }) => <div>ready {res.id}</div>,
            loading: Loading,
        });

        const { rerender } = render(<Island id="a1" />);
        await screen.findByText('ready a1');

        rerender(<Island id="a2" />);
        expect(screen.getByText('loading...')).toBeTruthy();
        expect(log).toEqual(['disposed:a1']);

        expect(await screen.findByText('ready a2')).toBeTruthy();
    });

    test('a superseded in-flight resolve never renders and its props are disposed', async () => {
        const log: string[] = [];
        const gates = new Map<string, ReturnType<typeof deferred<void>>>();
        const gateFor = (id: string) => {
            let gate = gates.get(id);
            if (!gate) {
                gate = deferred<void>();
                gates.set(id, gate);
            }
            return gate;
        };

        const Island = createIsland({
            useEnv: () => ({ prefix: 'env' }) as TestEnv,
            view: () =>
                createView.chain({ id: viewParam<string>() }).chain({
                    res: async ({ id }) => {
                        await gateFor(id).promise;
                        return disposable(id, log);
                    },
                }),
            component: ({ res }) => <div>ready {res.id}</div>,
            loading: Loading,
        });

        const { rerender } = render(<Island id="a1" />);
        // Wait until the a1 resolve is inside the level that grabs the resource
        // (cancellation between levels would skip the grab entirely)
        await waitFor(() => expect(gates.has('a1')).toBe(true));
        rerender(<Island id="a2" />);

        // The newer resolve lands first
        gateFor('a2').resolve();
        expect(await screen.findByText('ready a2')).toBeTruthy();

        // The stale resolve lands later: dropped and released, a2 stays on screen
        gateFor('a1').resolve();
        await waitFor(() => expect(log).toContain('disposed:a1'));
        expect(screen.getByText('ready a2')).toBeTruthy();
        expect(log).toEqual(['disposed:a1']);
    });
});
