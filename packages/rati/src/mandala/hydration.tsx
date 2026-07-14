import { createContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { SourceError } from '../scope/source';
import { createHydrationClaims } from './hydrationDiagnostics';

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

/**
 * One promise load that rejected during a collected server render. The render itself
 * degrades gracefully without rati's help (React emits the loading slot with a
 * client-retry marker; the client re-runs the load) — what the record adds is the
 * *server's* knowledge: map `error.code === 'not-available'` to a 404, `failed` to
 * the app's 5xx policy, before the degraded 200 goes out.
 */
export type HydrationError = { mandalaId: string; key: string; error: SourceError };

export type Hydration = {
    /** Client: server-resolved values to rehydrate the matching mandalas from. */
    data?: HydrationData | undefined;
    /** Client: server-dehydrated live-source seeds (`source.ssr.hydrate` inputs). */
    seeds?: HydrationData | undefined;
    /** Server: record a resolved value / live-source seed during the prerender pass.
     * `kind` defaults to 'value' — a collector predating seeds keeps working. */
    collect?:
        | ((mandalaId: string, key: string, value: unknown, kind?: 'value' | 'seed') => void)
        | undefined;
    /** Server: record a promise load that rejected during the prerender pass. */
    collectError?: ((mandalaId: string, key: string, error: SourceError) => void) | undefined;
    /** Client, diagnostic: notes a payload slice as consumed. Wired internally by
     * HydrationProvider (see hydrationDiagnostics.ts); apps never set it. */
    claim?: ((mandalaId: string, key: string, section: 'data' | 'seeds') => void) | undefined;
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
    collectError,
    data,
    seeds,
    children,
}: Omit<Hydration, 'claim'> & { children: ReactNode }) {
    // Rehydrating client (payload present, not collecting): watch for payload slices
    // no island ever claims — the loud version of "SSR silently turned itself off".
    const [claims] = useState(() =>
        !collect && (data || seeds) ? createHydrationClaims() : undefined,
    );
    useEffect(() => claims?.arm(data, seeds), [claims, data, seeds]);

    const value = useMemo<Hydration>(
        () => ({ collect, collectError, data, seeds, claim: claims?.claim }),
        [collect, collectError, data, seeds, claims],
    );
    return <HydrationContext.Provider value={value}>{children}</HydrationContext.Provider>;
}

/**
 * Server-side collector. Pass `.collect` into a {@link HydrationProvider} wrapping the
 * app, render with a Suspense-awaiting renderer (`react-dom/static` `prerender`), then
 * read `.data` / `.seeds` once the render resolves and embed them in the HTML response.
 * The client passes them back through {@link HydrationProvider}.
 */
export function createHydrationCollector(): {
    collect: (mandalaId: string, key: string, value: unknown, kind?: 'value' | 'seed') => void;
    collectError: (mandalaId: string, key: string, error: SourceError) => void;
    data: HydrationData;
    seeds: HydrationData;
    /** Loads that rejected during the render — the server's status-code input. */
    errors: HydrationError[];
} {
    const data: HydrationData = {};
    const seeds: HydrationData = {};
    const errors: HydrationError[] = [];
    return {
        data,
        seeds,
        errors,
        collect(mandalaId, key, value, kind = 'value') {
            ((kind === 'seed' ? seeds : data)[mandalaId] ??= {})[key] = value;
        },
        collectError(mandalaId, key, error) {
            errors.push({ mandalaId, key, error });
        },
    };
}
