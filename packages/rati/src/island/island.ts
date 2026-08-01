import type { Scope } from '../scope/scope';
import { createMandala, type MandalaComponent, type MandalaConfig } from '../mandala/mandala';

/**
 * An island component: a self-contained UI unit that resolves its own data from a scope
 * and renders, with loading/error slots. Its props are the scope's inputs (its `input()`
 * head). Read what it provides anywhere in its subtree with `useScope(scope)`.
 */
export type IslandComponent<S extends Scope<any>> = MandalaComponent<S>;

/** The inputs to {@link island}: a scope, the component, and optional loading/error slots. */
export type IslandConfig<S extends Scope<any>> = MandalaConfig<S>;

/**
 * Build a standalone island from a scope + component (+ loading/error). The island
 * resolves the scope's data waterfall, feeds the component its resolved props, and
 * provides the value to its subtree (`useScope`). For a URL-bound island, use `route`.
 */
export function island<S extends Scope<any>>(config: IslandConfig<S>): IslandComponent<S> {
    return createMandala(config, 'Island');
}

// The SSR-dehydration surface (`HydrationProvider`, `createHydrationCollector`) lives in
// the `rati/ssr` entry — it is orthogonal to islands (route islands use it too), so it
// carries no `Island` prefix. See ssr/index.ts and mandala/hydration.tsx.
