import { describe, test, expectTypeOf } from 'vite-plus/test';

import type { RatiUserTypes } from '../../router/route.js';
import type { ActiveRoute, ActiveRouteOf, Router } from '../../router/router.js';

/*
    The augmentation-typed surface behaves like the table-parameterized one: an `ActiveRoute`
    resolved through `UserRoutes`'s `infer` stays deferred and narrows nothing, and a deferred
    `to` fails OPEN. The table is routeContext.test-d.ts's: a second `declare module` collides.
*/

declare const active: ActiveRoute;
declare const router: Router;

describe('ActiveRoute through the augmentation (types)', () => {
    test('the name guard narrows routeParams — the discriminated union headline', () => {
        if (active.name === 'product') {
            expectTypeOf(active.routeParams).toEqualTypeOf<{ productId: string }>();
        }
        if (active.name === 'profile') {
            expectTypeOf(active.routeParams).toEqualTypeOf<{ userId: string }>();
        }
    });

    test('Extract filters by name', () => {
        expectTypeOf<Extract<ActiveRoute, { name: 'profile' }>['routeParams']>().toEqualTypeOf<{
            userId: string;
        }>();
    });

    test('ActiveRoute is the union ActiveRouteOf derives from the same table', () => {
        expectTypeOf<ActiveRoute>().toEqualTypeOf<ActiveRouteOf<RatiUserTypes['routes']>>();
    });
});

describe("navigate's `to` through the augmentation (types)", () => {
    test('a registered target with its params typechecks', () => {
        router.navigate({ name: 'product', productId: '1' });
        router.getPath({ name: 'profile', userId: '7' });
    });

    test('an unregistered name is rejected — a deferred `to` would fail open here', () => {
        // @ts-expect-error - 'nope' is not a registered route name
        router.navigate({ name: 'nope' });
    });

    test('missing params are rejected', () => {
        // @ts-expect-error - the product route requires productId
        router.navigate({ name: 'product' });
    });
});
