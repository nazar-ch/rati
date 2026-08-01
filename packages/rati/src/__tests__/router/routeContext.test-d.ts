import { describe, test, expectTypeOf } from 'vite-plus/test';
import { route } from '../../router/route';
import { scope, input, type ScopeComponent } from '../../scope/scope';
import { useRouteContext } from '../../router/useRouteContext';

// Register the app's route table the way an app does — `RatiUserTypes['routes'] =
// typeof routes`, the same augmentation `Link`'s `to` reads. `useRouteContext(name)`
// then types itself off these definitions, with no separate context registration.
// This augmentation is program-global, so it also types `useRouteContext('product')`
// in the sibling `routerIsland.test.tsx` runtime test.

// A providing route: its scope ends in `.provide()`, so the carried context is the
// provided value.
const productScope = scope({ productId: input<string>() }).provide(({ productId }) => ({
    label: `#${productId}`,
}));
const ProductBody: ScopeComponent<typeof productScope> = () => null;

// A scope without `.provide()`: the carried context is the resolved props
// (provide-by-default), exactly what `useScope` would return under the island.
const profileScope = scope({ userId: input<string>() }).load({ name: async () => 'n' });
const ProfileBody: ScopeComponent<typeof profileScope> = () => null;

const typedRoutes = [
    route('/products/:productId', 'product', ProductBody, { scope: productScope }),
    route('/users/:userId', 'profile', ProfileBody, { scope: profileScope }),
    // A scope-less route carries no context — excluded from the valid names below.
    route('/', 'home', () => null),
] as const;

declare module '../../router/route' {
    interface RatiUserTypes {
        routes: typeof typedRoutes;
    }
}

describe('useRouteContext (types)', () => {
    test('returns the .provide() value for a providing route — no type argument', () => {
        expectTypeOf(useRouteContext('product')).toEqualTypeOf<{ label: string }>();
    });

    test('returns the resolved props for a scope without .provide()', () => {
        expectTypeOf(useRouteContext('profile')).toEqualTypeOf<{ userId: string; name: string }>();
    });

    test('rejects a scope-less route name (no context to read)', () => {
        // @ts-expect-error - 'home' has no scope, so it carries no context
        useRouteContext('home');
    });

    test('rejects a name that is not a route', () => {
        // @ts-expect-error - 'nope' is not a registered route name
        useRouteContext('nope');
    });
});
