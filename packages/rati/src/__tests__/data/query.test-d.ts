import { describe, expectTypeOf, test } from 'vite-plus/test';

import { collection, type Collection } from '../../data/collection';
import { query, type Query, type ReadyQuery } from '../../data/query';
import { scope, type ScopeProps } from '../../scope/scope';
import { type Source } from '../../scope/source';

interface Row {
    id: string;
    title: string;
}

describe('ReadyQuery', () => {
    test('drops the undefined from `data` and keeps every other member', () => {
        expectTypeOf<ReadyQuery<Row>['data']>().toEqualTypeOf<Row>();
        expectTypeOf<Query<Row>['data']>().toEqualTypeOf<Row | undefined>();

        // The brand is a read-side claim, not an immutability one: the whole
        // instance surface still works through it.
        expectTypeOf<ReadyQuery<Row>['phase']>().toEqualTypeOf<Query<Row>['phase']>();
        expectTypeOf<ReadyQuery<Row>['error']>().toEqualTypeOf<Query<Row>['error']>();
    });

    test('is still a Query — assignable to one, and takes every mutator', () => {
        const q: ReadyQuery<Row> = query(async () => ({ id: 'a', title: 'A' })) as ReadyQuery<Row>;

        expectTypeOf(q).toExtend<Query<Row>>();
        expectTypeOf(q.reset()).toEqualTypeOf<void>();
        expectTypeOf(q.refresh()).toEqualTypeOf<Promise<void>>();
        expectTypeOf(q.prime()).toEqualTypeOf<Promise<void>>();
        expectTypeOf(q.set({ id: 'b', title: 'B' })).toEqualTypeOf<void>();
        q.patch((current) => {
            expectTypeOf(current).toEqualTypeOf<Row>();
            return current;
        });
    });
});

describe('query.source()', () => {
    test('is branded ready', () => {
        const q = query(async () => ({ id: 'a', title: 'A' }));
        expectTypeOf(q.source()).toEqualTypeOf<Source<ReadyQuery<Row>>>();
    });

    test('the island-resolved prop reads `data` with no narrowing', () => {
        const rowScope = scope().load({
            row: () => query(async (): Promise<Row> => ({ id: 'a', title: 'A' })).source(),
        });

        type Props = ScopeProps<typeof rowScope>;
        expectTypeOf<Props['row']>().toEqualTypeOf<ReadyQuery<Row>>();
        // The point of the item: no `?? ` and no `!` in the component body.
        expectTypeOf<Props['row']['data']['title']>().toEqualTypeOf<string>();
    });
});

describe('collection.source()', () => {
    // DATA-15 decision: no `ReadyCollection`. `items` is `readonly Item[]` in
    // every phase (empty before the first fetch), so there is no undefined to
    // strip — the brand would carry no information.
    test('resolves the instance itself, unbranded', () => {
        const rows = collection({
            fetch: async (): Promise<Row[]> => [],
            key: (row: Row) => row.id,
        });

        expectTypeOf(rows.source()).toEqualTypeOf<Source<Collection<Row, Row>>>();
        expectTypeOf(rows.items).toEqualTypeOf<readonly Row[]>();
    });
});
