import { describe, test, expect, afterEach } from 'vite-plus/test';

import { island } from '../../island/island.js';
import { scope, input } from '../../scope/scope.js';
import { NotAvailableError, toSourceError, type SourceError } from '../../scope/source.js';
import { cleanup, renderIsland, ssrRender } from '../../testing/index.js';

afterEach(cleanup);

/*
    The two-level `SourceError` and the seam that fills it in.

    Top level: `retryable` — transient (true) / terminal (false) / unclassified (absent),
    the only thing the retry policy consults. Flavor: `code`, what an error slot switches
    on. Classification happens at the *app's* transport edge — rati ships no fetch helper
    and knows nothing of HTTP — so the seam has to take any error the app throws: carry a
    string `code` (and optionally a boolean `retryable`) and it maps through intact.
*/

/** The shape an app's transport edge produces: a plain error, classified in place. */
function apiError(message: string, code: string, retryable?: boolean): Error {
    return Object.assign(new Error(message), {
        code,
        ...(retryable === undefined ? {} : { retryable }),
    });
}

describe('toSourceError — the classification seam', () => {
    test('carries a string `code` and a boolean `retryable` through intact', () => {
        expect(toSourceError(apiError('nope', 'forbidden', false))).toMatchObject({
            code: 'forbidden',
            message: 'nope',
            retryable: false,
        });
        expect(toSourceError(apiError('later', 'unreachable', true))).toMatchObject({
            code: 'unreachable',
            retryable: true,
        });
    });

    test('a custom Error class is the same seam — no subclass of ours needed', () => {
        class ApiError extends Error {
            constructor(
                message: string,
                readonly code: string,
                readonly retryable: boolean,
            ) {
                super(message);
            }
        }

        expect(toSourceError(new ApiError('boom', 'invalid', false))).toMatchObject({
            code: 'invalid',
            retryable: false,
        });
    });

    test('a code without a flag stays unclassified on the top level', () => {
        const error = toSourceError(apiError('nope', 'forbidden'));

        expect(error.code).toBe('forbidden');
        // Absent, not `undefined`: "the app never said" is a missing key on the wire too.
        expect('retryable' in error).toBe(false);
    });

    test('a plain Error is the unclassified fallback — `failed`, no flag', () => {
        const thrown = new Error('backend exploded');
        const error = toSourceError(thrown);

        expect(error).toMatchObject({ code: 'failed', message: 'backend exploded', cause: thrown });
        expect('retryable' in error).toBe(false);
    });

    test('a non-error rejection lands there too', () => {
        expect(toSourceError('just a string')).toEqual({ code: 'failed', cause: 'just a string' });
    });

    test('NotAvailableError is unchanged — including its own code option', () => {
        const plain = toSourceError(new NotAvailableError('gone'));
        expect(plain).toMatchObject({ code: 'not-available', message: 'gone' });
        expect('retryable' in plain).toBe(false);

        // The code option jnana used to smuggle a dialect through; still honored, and now
        // no longer the only way in.
        expect(toSourceError(new NotAvailableError('nope', { code: 'forbidden' })).code).toBe(
            'forbidden',
        );
        // ...and the flag rides along when the subclass sets one.
        const flagged = Object.assign(new NotAvailableError('warming up'), { retryable: true });
        expect(toSourceError(flagged)).toMatchObject({ code: 'not-available', retryable: true });
    });
});

describe('the two levels reach an island', () => {
    test('a classified throw arrives whole in the error slot', async () => {
        let seen: SourceError | null = null;
        const handle = await renderIsland(
            {
                scope: scope({ id: input<string>() }).load({
                    page: async (): Promise<string> => {
                        throw apiError('nope', 'forbidden', false);
                    },
                }),
                component: () => <div>ready</div>,
                loading: () => <div>loading</div>,
                error: ({ error }: { error: SourceError }) => {
                    seen = error;
                    return <div>{`error: ${error.code}`}</div>;
                },
            },
            { props: { id: 'a1' } },
        );

        expect(handle.slot()).toBe('error');
        expect(handle.text()).toBe('error: forbidden');
        expect(seen).toMatchObject({ code: 'forbidden', message: 'nope', retryable: false });
    });

    test('...and across the SSR wire, both levels', async () => {
        const Island = island({
            scope: scope({ id: input<string>() }).load({
                page: async (): Promise<string> => {
                    throw apiError('nope', 'forbidden', false);
                },
            }),
            component: () => <div>ready</div>,
            loading: () => <div>LOADING-SLOT</div>,
            error: ({ error }: { error: SourceError }) => <div>{`ERROR-SLOT: ${error.code}`}</div>,
            ssrErrors: 'dehydrate' as const,
        });

        const server = await ssrRender(<Island id="a1" />);

        expect(server.html).toContain('ERROR-SLOT: forbidden');
        expect(Object.values(server.dehydratedErrors)[0]).toEqual({
            page: { code: 'forbidden', message: 'nope', retryable: false },
        });
    });
});
