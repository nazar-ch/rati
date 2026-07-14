import type { HydrationData } from '../mandala/hydration';
import type { RouterHydratedState } from '../router/store';
import { deepEqual } from '../util/utils';

/*
    The hydration payload: one versioned state object carried from the server render to
    the client in an *inert* JSON script tag.

    `<script type="application/json">` never executes, which buys two things over the
    classic `window.__STATE__ =` inline script: a strict Content-Security-Policy needs
    no unsafe-inline/nonce for it, and there is no ordering contract — the client entry
    is a deferred module, so the whole document (tag included) is parsed before
    readHydration runs, wherever the tag sits. Escaping is still required: a literal
    `</script>` (or `<!--`) inside the JSON would end the tag early, so `<` `>` `&` are
    escaped as \uXXXX (valid JSON, transparent to JSON.parse). U+2028/29 are legal in
    JSON but stay escaped so the payload also survives if an app ever inlines it into a
    JavaScript context.
*/

/**
 * Everything a server render dehydrates, in one versioned shape: the routing snapshot
 * plus the island registries (`data` values, live-source `seeds`). `v` guards against
 * a stale cached HTML page meeting a newer client bundle: on a mismatch the client
 * falls back to resolving from scratch rather than misreading the payload.
 */
export interface HydrationState {
    v: 1;
    router?: RouterHydratedState;
    data: HydrationData;
    seeds: HydrationData;
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
 * Serialize the dehydrated state into the script tag readHydration() reads. Splice the
 * result anywhere in the document — before `</body>` by convention. Outside production
 * it also warns about values that don't survive JSON (a `Date` resolves fine on the
 * server and arrives as a string on the client, silently).
 */
export function serializeHydration(
    state: Omit<HydrationState, 'v'>,
    options: { id?: string } = {},
): string {
    const full: HydrationState = { v: 1, ...state };
    // globalThis-based so the module needs no Node types and stays importable in
    // browser bundles (where the whole check simply short-circuits).
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
        parsed = JSON.parse(element.textContent ?? '');
    } catch (error) {
        console.error(`[rati] hydration payload #${id} is not valid JSON`, error);
        return null;
    }
    const state = parsed as HydrationState;
    if (state.v !== 1) {
        console.error(
            `[rati] hydration payload #${id} has version ${String(state.v)}, expected 1 — ` +
                `ignoring it (stale HTML meeting a newer client?)`,
        );
        return null;
    }
    return state;
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
