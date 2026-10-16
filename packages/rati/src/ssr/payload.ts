import type { HydrationData, HydrationErrors } from '../mandala/hydration.js';
import type { RouterHydratedState } from '../router/store.js';
import { deepEqual } from '../util/utils.js';

/*
    The hydration payload: one versioned state object in an INERT JSON script tag — no CSP nonce,
    no ordering contract. `<` `>` `&` are escaped as \uXXXX so a literal `</script>` cannot end
    the tag, and `U+2028`/`U+2029` so the JSON survives a JavaScript context.
*/

/**
 * Everything a server render dehydrates, in one versioned shape: the routing snapshot
 * plus the island registries (`data` values, live-source `seeds`, dehydrated `errors`).
 * `v` guards against a stale cached HTML page meeting a newer client bundle: on a
 * mismatch the client resolves from scratch.
 */
export interface HydrationState {
    v: 1;
    router?: RouterHydratedState;
    data: HydrationData;
    seeds: HydrationData;
    /**
     * Loads that failed server-side on islands running `ssrErrors: 'dehydrate'`, omitted
     * when there are none; a client ignoring the field re-runs the load, the default.
     */
    errors?: HydrationErrors;
}

export const HYDRATION_SCRIPT_ID = '__rati-hydration';

const UNSAFE = /[<>&\u{2028}\u{2029}]/gu;
const ESCAPES: Record<string, string> = {
    '<': '\\u003c',
    '>': '\\u003e',
    '&': '\\u0026',
    '\u2028': '\\u2028',
    '\u2029': '\\u2029',
};

/**
 * Serializes the dehydrated state into the script tag readHydration() reads, spliced
 * anywhere — before `</body>` by convention. Outside production it warns about a value that
 * doesn't survive JSON (a `Date` arrives on the client as a string).
 */
export function serializeHydration(
    state: Omit<HydrationState, 'v'>,
    options: { id?: string } = {},
): string {
    const full: HydrationState = { v: 1, ...state };
    // globalThis-based so the module needs no Node types and stays importable in
    // browser bundles (where the whole check short-circuits).
    const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
        ?.env;
    if (env && env['NODE_ENV'] !== 'production') {
        warnNonRoundTripping(full);
    }
    const json = JSON.stringify(full).replace(UNSAFE, (char) => ESCAPES[char] ?? char);
    return `<script type="application/json" id="${options.id ?? HYDRATION_SCRIPT_ID}">${json}</script>`;
}

/**
 * Read the server-embedded payload on the client, before `hydrateRoot`. Returns `null`
 * when there is no payload (a client-only boot) or it is unreadable/version-mismatched
 * — callers treat `null` as "resolve from scratch".
 */
export function readHydration(options: { id?: string } = {}): HydrationState | null {
    if (typeof document === 'undefined') return null;
    const id = options.id ?? HYDRATION_SCRIPT_ID;
    const element = document.getElementById(id);
    if (!element) return null;

    let parsed: unknown;
    try {
        // textContent is nullable on Node in general; this element always has some.
        parsed = JSON.parse((element.textContent as string | null) ?? '');
    } catch (error) {
        console.error(`[rati] hydration payload #${id} is not valid JSON`, error);
        return null;
    }
    // Validate the version against the UNNARROWED shape — the JSON is runtime input,
    // whatever HydrationState's literal type claims.
    const version = (parsed as { v?: unknown }).v;
    if (version !== 1) {
        console.error(
            `[rati] hydration payload #${id} has version ${String(version)}, expected 1 — ` +
                `ignoring it (stale HTML meeting a newer client?)`,
        );
        return null;
    }
    return parsed as HydrationState;
}

function warnNonRoundTripping(state: HydrationState): void {
    const sections = [
        ['data', state.data],
        ['seeds', state.seeds],
    ] as const;
    for (const [section, registry] of sections) {
        for (const [mandalaId, slice] of Object.entries(registry)) {
            for (const [key, value] of Object.entries(slice)) {
                let survives: boolean;
                try {
                    // The lib type lies (`string`): stringify yields undefined for
                    // undefined/function inputs, so the check is real.
                    const json = JSON.stringify(value) as string | undefined;
                    survives = json !== undefined && deepEqual(value, JSON.parse(json));
                } catch {
                    survives = false;
                }
                if (!survives) {
                    console.warn(
                        `[rati] hydration value ${section}[${JSON.stringify(mandalaId)}].${key} ` +
                            `does not survive JSON — the client will hydrate a different value ` +
                            `(Dates, Maps/Sets, class instances, undefined and NaN don't round-trip).`,
                    );
                }
            }
        }
    }
}
