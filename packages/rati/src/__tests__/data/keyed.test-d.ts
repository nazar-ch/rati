import { describe, test, expectTypeOf } from 'vite-plus/test';
import { keyed, type Keyed } from '../../data/keyed';
import { query, type Query } from '../../data/query';

/** The app-side id shape the map has to accept: a branded string. */
type SpaceId = string & { readonly __brand: 'SpaceId' };

declare const spaceId: SpaceId;

describe('keyed', () => {
    test('infers the key and the instance from the factory', () => {
        const members = keyed((id: string) => query(async () => [id]));

        expectTypeOf(members).toEqualTypeOf<Keyed<string, Query<string[]>>>();
        expectTypeOf(members.get('a')).toEqualTypeOf<Query<string[]>>();
        expectTypeOf(members.peek('a')).toEqualTypeOf<Query<string[]> | undefined>();
        expectTypeOf(members.reset()).toEqualTypeOf<void>();
    });

    test('takes a branded string key — and rejects a plain string for it', () => {
        const members = keyed((id: SpaceId) => query(async () => [id]));

        expectTypeOf(members.get(spaceId)).toEqualTypeOf<Query<SpaceId[]>>();
        // @ts-expect-error a plain string is not the branded key
        members.get('s1');
        // @ts-expect-error `peek` is keyed just as tightly
        members.peek('s1');
    });

    test('takes a number key', () => {
        const rows = keyed((id: number) => ({ id }));
        expectTypeOf(rows.get(1)).toEqualTypeOf<{ id: number }>();
        // @ts-expect-error the key type is the factory's parameter
        rows.get('1');
    });

    test('rejects a key that is not Map-safe', () => {
        // @ts-expect-error keys are `string | number` — an object key would make
        // per-key identity reference identity, which is not the contract.
        keyed((id: { id: string }) => id);
    });
});
