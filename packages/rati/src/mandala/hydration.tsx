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

    Three wire sections, one registry shape:

      - `data` — resolved *values*: promise loads, and SSR-marked loader sources
        (`ssr: true`), which hydrate exactly like promises (the client short-circuits to
        the value; the loader never runs client-side).
      - `seeds` — *live-source seeds*: what an `ssr: { dehydrate?, hydrate }` source
        dehydrated. The client creates the source as usual and feeds the seed to its
        `hydrate()` before attaching, so the first snapshot is already ready.
      - `errors` — loads that *failed* server-side, for islands that asked for their
        failure to cross the wire (`ssrErrors: 'dehydrate'`). The client hydrates that
        cell straight to its error state, so the error slot the server rendered stays.
        Empty for everyone else: the default is React's own client retry, and a backend's
        error text has no business in the HTML unless the island asked for it.

    A plain (unmarked) source is a reactive state machine, not a promise: it stays
    pending under SSR and resolves on the client after hydration — nothing to carry.

    The mandala engine owns this end to end — it is orthogonal to the router. A route is
    just a mandala, so route SSR participates for free; a standalone island SSR'd without
    a router participates the same way. (These are the public SSR surface, re-exported
    from the `rati/ssr` entry — see ssr/index.ts.)
*/

// mandalaId (useId) -> scope key -> dehydrated value (or live-source seed).
export type HydrationData = Record<string, Record<string, unknown>>;

// The same shape for the `errors` section: mandalaId -> scope key -> the failure that
// crossed the wire. Only islands running `ssrErrors: 'dehydrate'` put anything here.
export type HydrationErrors = Record<string, Record<string, SourceError>>;

/** Which payload section a claim belongs to — see {@link Hydration.claim}. */
export type HydrationSection = 'data' | 'seeds' | 'errors';

/**
 * One promise load that rejected during a collected server render. By default the render
 * degrades gracefully without rati's help (React emits the loading slot with a
 * client-retry marker; the client re-runs the load) — what the record adds is the
 * *server's* knowledge: map `error.code === 'not-available'` to a 404, `failed` to
 * the app's 5xx policy, before the degraded 200 goes out. Every failure is recorded,
 * whichever `ssrErrors` mode the island runs.
 */
export type HydrationError = { mandalaId: string; key: string; error: SourceError };

export type Hydration = {
    /** Client: server-resolved values to rehydrate the matching mandalas from. */
    data?: HydrationData | undefined;
    /** Client: server-dehydrated live-source seeds (`source.ssr.hydrate` inputs). */
    seeds?: HydrationData | undefined;
    /** Client: server-dehydrated load failures (`ssrErrors: 'dehydrate'` islands only) —
     * the cell hydrates straight to its error state. */
    errors?: HydrationErrors | undefined;
    /** Server: record a resolved value / live-source seed during the prerender pass.
     * `kind` defaults to 'value' — a collector predating seeds keeps working. */
    collect?:
        | ((mandalaId: string, key: string, value: unknown, kind?: 'value' | 'seed') => void)
        | undefined;
    /** Server: record a promise load that rejected during the prerender pass. `dehydrate`
     * (the island's `ssrErrors: 'dehydrate'`) additionally carries it to the client. */
    collectError?:
        | ((mandalaId: string, key: string, error: SourceError, dehydrate?: boolean) => void)
        | undefined;
    /** Client, diagnostic: notes a payload slice as consumed. Wired internally by
     * HydrationProvider (see hydrationDiagnostics.ts); apps never set it. */
    claim?: ((mandalaId: string, key: string, section: HydrationSection) => void) | undefined;
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
    errors,
    children,
}: Omit<Hydration, 'claim'> & { children: ReactNode }) {
    // Rehydrating client (payload present, not collecting): watch for payload slices
    // no island ever claims — the loud version of "SSR silently turned itself off".
    const [claims] = useState(() =>
        !collect && (data || seeds || errors) ? createHydrationClaims() : undefined,
    );
    useEffect(() => claims?.arm(data, seeds, errors), [claims, data, seeds, errors]);

    const value = useMemo<Hydration>(
        () => ({ collect, collectError, data, seeds, errors, claim: claims?.claim }),
        [collect, collectError, data, seeds, errors, claims],
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
    collectError: (mandalaId: string, key: string, error: SourceError, dehydrate?: boolean) => void;
    data: HydrationData;
    seeds: HydrationData;
    /** Loads that rejected during the render — the server's status-code input. Every
     *  failure lands here, whichever `ssrErrors` mode its island runs. */
    errors: HydrationError[];
    /** The `errors` *wire section*: the subset the islands asked to carry to the client
     *  (`ssrErrors: 'dehydrate'`), normalized to what survives JSON. Its sibling above is
     *  the flat list the server derives a status from and never leaves the server. */
    dehydratedErrors: HydrationErrors;
} {
    const data: HydrationData = {};
    const seeds: HydrationData = {};
    const errors: HydrationError[] = [];
    const dehydratedErrors: HydrationErrors = {};
    return {
        data,
        seeds,
        errors,
        dehydratedErrors,
        collect(mandalaId, key, value, kind = 'value') {
            ((kind === 'seed' ? seeds : data)[mandalaId] ??= {})[key] = value;
        },
        collectError(mandalaId, key, error, dehydrate = false) {
            errors.push({ mandalaId, key, error });
            if (dehydrate) (dehydratedErrors[mandalaId] ??= {})[key] = wireError(error);
        },
    };
}

/**
 * A `SourceError` reduced to what crosses the wire: `code`, `message`, `retryable`.
 *
 * `cause` is dropped, and that is the whole of it. It is the one field with no wire shape
 * — a live `Error` JSON-stringifies to `{}` (so the client would read a lie), and a cause
 * chain can hold anything the backend threw, functions and request objects included. What
 * the error slot switches on (`code`) and shows (`message`) survives; the server keeps the
 * rest, where the stack that produced it also lives.
 *
 * The message itself *does* travel, which is the trade an island makes by opting in: it is
 * written into the HTML for anyone to read. A load whose failures must not leak backend
 * text should say so in its own `message` before rejecting.
 */
function wireError(error: SourceError): SourceError {
    const wire: SourceError = { code: error.code };
    if (error.message !== undefined) wire.message = error.message;
    if (error.retryable !== undefined) wire.retryable = error.retryable;
    return wire;
}
