import { describe, test, expectTypeOf } from 'vite-plus/test';

import type { RatiUserTypes } from '../../router/route.js';
import type { ActiveRoute, ActiveRouteOf, Router } from '../../router/router.js';

/*
    FND-06 — the augmentation-typed surface must behave like the table-parameterized one.
    The route table is the sibling routeContext.test-d.ts's augmentation (`typedRoutes`:
    product / profile / home) — a `declare module` is program-global, so registering a
    second one here would collide; these probes deliberately read the same table.

    The trap this file pins: `ActiveRoute` resolved through the `infer`ed `UserRoutes`
    conditional stays deferred — `name` and `routeParams` read as the right unions but the
    discriminant narrows nothing, and `Extract` filters nothing. A deferred `to` on
    `navigate` is worse: it fails *open*, accepting targets that should not typecheck.
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
