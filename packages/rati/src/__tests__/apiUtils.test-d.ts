import { describe, test, expectTypeOf } from 'vitest';
import { responseKey } from '../data/apiUtils';

const apiCall = async (_v: { x: string }) => ({
    a: '1',
    b: { k: 2 },
});

const arrayApiCall = async () => [1, 2, 3];

describe('responseKey()', () => {
    test('returns a function whose result is the picked key value', () => {
        const getA = responseKey(apiCall, 'a');
        expectTypeOf(getA).returns.resolves.toEqualTypeOf<string>();

        const getB = responseKey(apiCall, 'b');
        expectTypeOf(getB).returns.resolves.toEqualTypeOf<{ k: number }>();
    });

    test('rejects keys that do not exist on the response', () => {
        // @ts-expect-error - 'nonexistent' is not a key of the API response
        responseKey(apiCall, 'nonexistent');
    });

    test('requires the API call arguments when invoked', () => {
        const getB = responseKey(apiCall, 'b');
        // @ts-expect-error - apiCall requires { x: string }
        getB();
    });

    test('rejects functions whose return type is not an indexable object', () => {
        // @ts-expect-error - arrayApiCall returns number[], which is not Record<string, unknown>
        responseKey(arrayApiCall, 0);
    });
});
