import type { Scope } from '../common/scope';
import { createMandala, type MandalaComponent, type MandalaConfig } from '../mandala/mandala';

/**
 * An island component: a self-contained UI unit that resolves its own data from a scope
 * and renders, with loading/error slots. Its props are the scope's `prop()` inputs.
 * Read what it provides anywhere in its subtree with `useScope(scope)`.
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

// The public SSR-dehydration surface: the mandala engine's hydration, island-branded.
export {
    HydrationProvider as IslandHydrationProvider,
    createHydrationCollector as createIslandHydrationCollector,
} from '../mandala/hydration';
export type {
    Hydration as IslandHydration,
    HydrationData as IslandHydrationData,
} from '../mandala/hydration';
