import { createContext, useMemo, type ReactNode } from 'react';

/*
    SSR data hydration for mandalas (islands and routes).

    Under a Suspense-awaiting server render (`react-dom/static` `prerender`) a mandala
    resolves its *promise* entries via `use()` server-side, so the HTML carries the
    resolved content. Without dehydration the client would re-run those promises on
    hydration — a wasted re-fetch and, worse, a re-suspend that flashes the loading slot
    and risks a hydration mismatch.

    This module carries each mandala's resolved promise values across the wire so the
    client short-circuits them to their server values and hydrates synchronously. The key
    is the mandala's `useId()` (stable between server render and hydration by tree
    position) then the scope key — so arbitrarily nested / composed mandalas each own a
    unique slice with no collisions, and the registry stays flat.

    Two wire sections, one registry shape:

      - `data` — resolved *values*: promise loads, and SSR-marked loader sources
        (`ssr: true`), which hydrate exactly like promises (the client short-circuits to
        the value; the loader never runs client-side).
      - `seeds` — *live-source seeds*: what an `ssr: { dehydrate?, hydrate }` source
        dehydrated. The client creates the source as usual and feeds the seed to its
        `hydrate()` before attaching, so the first snapshot is already ready.

    A plain (unmarked) source is a reactive state machine, not a promise: it stays
    pending under SSR and resolves on the client after hydration — nothing to carry.

    The mandala engine owns this end to end — it is orthogonal to the router. A route is
    just a mandala, so route SSR participates for free; a standalone island SSR'd without
    a router participates the same way. (These are the public SSR surface, re-exported
    from the `rati/ssr` entry — see ssr/index.ts.)
*/

// mandalaId (useId) -> scope key -> dehydrated value (or live-source seed).
export type HydrationData = Record<string, Record<string, unknown>>;

export type Hydration = {
    /** Client: server-resolved values to rehydrate the matching mandalas from. */
    data?: HydrationData | undefined;
    /** Client: server-dehydrated live-source seeds (`source.ssr.hydrate` inputs). */
    seeds?: HydrationData | undefined;
    /** Server: record a resolved value / live-source seed during the prerender pass. */
    collect?:
        | ((mandalaId: string, key: string, value: unknown, kind: 'value' | 'seed') => void)
        | undefined;
};

// Default is the empty registry: mandalas rendered with no provider above (jnana's SPA,
// tests, any non-SSR host) neither collect nor rehydrate — they just resolve.
export const HydrationContext = createContext<Hydration>({});

/**
 * Wrap the app at the SSR boundary so mandalas anywhere in the tree participate in
 * dehydration. On the server pass `collect` (from {@link createHydrationCollector}); on
 * the client pass the serialized `data` (and `seeds`, when the app uses SSR-marked live
 * sources). Renders no DOM of its own, so mounting it on both sides keeps the trees
 * identical (and `useId` stable).
 */
export function HydrationProvider({
    collect,
    data,
    seeds,
    children,
}: Hydration & { children: ReactNode }) {
    const value = useMemo<Hydration>(() => ({ collect, data, seeds }), [collect, data, seeds]);
    return <HydrationContext.Provider value={value}>{children}</HydrationContext.Provider>;
}

/**
 * Server-side collector. Pass `.collect` into a {@link HydrationProvider} wrapping the
 * app, render with a Suspense-awaiting renderer (`react-dom/static` `prerender`), then
 * read `.data` / `.seeds` once the render resolves and embed them in the HTML response.
 * The client passes them back through {@link HydrationProvider}.
 */
export function createHydrationCollector(): {
    collect: (mandalaId: string, key: string, value: unknown, kind: 'value' | 'seed') => void;
    data: HydrationData;
    seeds: HydrationData;
} {
    const data: HydrationData = {};
    const seeds: HydrationData = {};
    return {
        data,
        seeds,
        collect(mandalaId, key, value, kind) {
            ((kind === 'seed' ? seeds : data)[mandalaId] ??= {})[key] = value;
        },
    };
}
