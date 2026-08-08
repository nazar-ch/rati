import { describe, test, expectTypeOf } from 'vite-plus/test';

import type { SourceError, SourceErrorCode } from '../../scope/source';

/*
    The `code` vocabulary is an *open* set — the five blessed values for completion, the
    `(string & {})` arm so an app can coin its own without augmenting anything. These pins
    are the reason `SourceError.code` can be the union rather than a bare `string`: the two
    are mutually assignable, so nothing an app already writes stops compiling.
*/

describe('SourceErrorCode', () => {
    test('the blessed five are members, and so is any other string', () => {
        expectTypeOf<'not-available'>().toExtend<SourceErrorCode>();
        expectTypeOf<'forbidden'>().toExtend<SourceErrorCode>();
        expectTypeOf<'invalid'>().toExtend<SourceErrorCode>();
        expectTypeOf<'unreachable'>().toExtend<SourceErrorCode>();
        expectTypeOf<'failed'>().toExtend<SourceErrorCode>();
        expectTypeOf<'rate-limited'>().toExtend<SourceErrorCode>();
    });

    test('it stays interchangeable with `string` in both directions', () => {
        expectTypeOf<string>().toExtend<SourceErrorCode>();
        expectTypeOf<SourceErrorCode>().toExtend<string>();
    });
});

describe('SourceError', () => {
    test('two levels: an open `code`, and `retryable` as a plain optional flag', () => {
        const error: SourceError = { code: 'forbidden', retryable: false };

        expectTypeOf(error.code).toExtend<string>();
        expectTypeOf(error.retryable).toEqualTypeOf<boolean | undefined>();
        // A coined code needs no declaration merging to be assignable.
        expectTypeOf<{ code: 'rate-limited' }>().toExtend<SourceError>();
        // ...and a `code` read off some other object still fits.
        expectTypeOf<{ code: string }>().toExtend<SourceError>();
    });
});
