import { createContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { createHydrationClaims } from './hydrationDiagnostics.js';

import type { SourceError } from '../scope/source.js';

/*
    SSR data hydration for mandalas: resolved promise values, live-source seeds and
    dehydrated failures cross the wire keyed by the mandala's `useId()`, then the scope key, so
    the client short-circuits them and hydrates synchronously. The design is
    docs/current/internals.md.
*/

// mandalaId (useId) -> scope key -> dehydrated value (or live-source seed).
export type HydrationData = Record<string, Record<string, unknown>>;

// The same shape for the `errors` section: mandalaId -> scope key -> the failure that
// crossed the wire. Only islands running `ssrErrors: 'dehydrate'` put anything here.
export type HydrationErrors = Record<string, Record<string, SourceError>>;

/** Which payload section a claim belongs to — see {@link Hydration.claim}. */
export type HydrationSection = 'data' | 'seeds' | 'errors';

/**
 * One promise load that rejected during a collected server render — the server's input for
 * mapping `not-available` to a 404 and `failed` to its 5xx policy before the response goes
 * out. Every failure is recorded, whichever `ssrErrors` mode the island runs.
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
     * `kind` defaults to 'value'. */
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

// Default is the empty registry: mandalas with no provider above (a client-only app, tests)
// neither collect nor rehydrate.
export const HydrationContext = createContext<Hydration>({});

/**
 * Wraps the app at the SSR boundary so mandalas anywhere in the tree take part in
 * dehydration: the server passes `collect` ({@link createHydrationCollector}), the client
 * the serialized payload. Renders no DOM, so both sides keep identical trees and `useId`s.
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
 * Server-side collector: pass `.collect` into a {@link HydrationProvider} wrapping the app,
 * render with `prerender`, then embed `.data` / `.seeds` in the HTML response for the
 * client's {@link HydrationProvider}.
 */
export function createHydrationCollector(): {
    collect: (mandalaId: string, key: string, value: unknown, kind?: 'value' | 'seed') => void;
    collectError: (mandalaId: string, key: string, error: SourceError, dehydrate?: boolean) => void;
    data: HydrationData;
    seeds: HydrationData;
    /** Loads that rejected during the render — the server's status-code input. Every
     *  failure lands here, whichever `ssrErrors` mode its island runs. */
    errors: HydrationError[];
    /** The `errors` wire section: the subset the islands asked to carry to the client
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
 * A `SourceError` reduced to what crosses the wire: `code`, `message`, `retryable`. `cause`
 * is dropped — a live `Error` stringifies to `{}`, and a cause chain holds anything the
 * backend threw. The message DOES travel into the HTML, the trade an island makes by opting in.
 */
function wireError(error: SourceError): SourceError {
    const wire: SourceError = { code: error.code };
    if (error.message !== undefined) wire.message = error.message;
    if (error.retryable !== undefined) wire.retryable = error.retryable;
    return wire;
}
