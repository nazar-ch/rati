import { createContext, useMemo, type ReactNode } from 'react';

/*
    SSR data hydration for islands.

    Under a Suspense-awaiting server render (`react-dom/static` `prerender`) an
    island resolves its *promise* entries via `use()` server-side, so the HTML
    carries the resolved content. Without dehydration the client would re-run those
    promises on hydration — a wasted re-fetch and, worse, a re-suspend that flashes
    the loading slot and risks a hydration mismatch.

    This module carries each island's resolved promise values across the wire so the
    client short-circuits them to their server values and hydrates synchronously. The
    key is the island's `useId()` (stable between server render and hydration by tree
    position) then the chain key — so arbitrarily nested / composed islands each own a
    unique slice with no collisions, and the registry stays flat.

    Only promises are serialized. A *source* is a reactive state machine, not a
    promise: it stays pending under SSR and resolves on the client after hydration,
    so there is nothing to carry for it.

    The island engine owns this end to end — it is orthogonal to the router. A route
    is just an island, so route SSR participates for free; a standalone island SSR'd
    without a router participates the same way.
*/

// islandId (useId) -> chain key -> resolved promise value.
export type IslandHydrationData = Record<string, Record<string, unknown>>;

export type IslandHydration = {
    /** Client: server-resolved values to rehydrate the matching islands from. */
    data?: IslandHydrationData | undefined;
    /** Server: record a resolved promise value during the prerender pass. */
    collect?: ((islandId: string, key: string, value: unknown) => void) | undefined;
};

// Default is the empty registry: islands rendered with no provider above (jnana's
// SPA, tests, any non-SSR host) neither collect nor rehydrate — they just resolve.
export const IslandHydrationContext = createContext<IslandHydration>({});

/**
 * Wrap the app at the SSR boundary so islands anywhere in the tree participate in
 * dehydration. On the server pass `collect` (from {@link createIslandHydrationCollector});
 * on the client pass the serialized `data`. Renders no DOM of its own, so mounting
 * it on both sides keeps the trees identical (and `useId` stable).
 */
export function IslandHydrationProvider({
    collect,
    data,
    children,
}: IslandHydration & { children: ReactNode }) {
    const value = useMemo<IslandHydration>(() => ({ collect, data }), [collect, data]);
    return (
        <IslandHydrationContext.Provider value={value}>{children}</IslandHydrationContext.Provider>
    );
}

/**
 * Server-side collector. Pass `.collect` into an {@link IslandHydrationProvider}
 * wrapping the app, render with a Suspense-awaiting renderer (`react-dom/static`
 * `prerender`), then read `.data` once the render resolves and embed it in the HTML
 * response. The client passes that data back through {@link IslandHydrationProvider}.
 */
export function createIslandHydrationCollector(): {
    collect: (islandId: string, key: string, value: unknown) => void;
    data: IslandHydrationData;
} {
    const data: IslandHydrationData = {};
    return {
        data,
        collect(islandId, key, value) {
            (data[islandId] ??= {})[key] = value;
        },
    };
}
