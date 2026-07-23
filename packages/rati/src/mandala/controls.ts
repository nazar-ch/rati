import { createContext, useContext, useSyncExternalStore, type Context } from 'react';
import type { Scope, ScopeLoadKeys } from '../scope/scope';
import { describeScope } from './channel';
import type { IslandPhase, IslandStatus, RefreshController } from './refresh';

/*
    The controls channel — `useScopeControls`. A second scope-keyed channel next to the
    value channel (channel.ts): the value channel publishes what an island resolved; this
    one publishes verbs on the island instance itself. Components keep receiving strictly
    resolved state — the controls stay behind a hook, no promises or sources leak out.
*/

const controlsChannels = new WeakMap<object, Context<RefreshController | null>>();
const noControlsChannel = createContext<RefreshController | null>(null);

// Get-or-create the controls channel for a scope (shared across mandalas built from the
// same scope — nearest instance wins, ordinary context semantics). Called by
// createMandala when wiring a new mandala component.
export function registerScopeControlsChannel(scope: object): Context<RefreshController | null> {
    const channel = controlsChannels.get(scope) ?? createContext<RefreshController | null>(null);
    controlsChannels.set(scope, channel);
    return channel;
}

export type ScopeControls<S extends Scope<any>> = {
    /**
     * Re-resolve. With no key the whole scope re-resolves (the retry mechanism — the
     * loading slot shows again). With a key, only that load re-runs: the previous value
     * stays rendered while the re-fetch is in flight, an unchanged result (per the
     * load's `equals` — deep by default, see `data()`) keeps the old value and identity,
     * and a changed one re-runs exactly the downstream loads whose producers consumed
     * the key. Promise loads only — sources are live and refresh themselves. The
     * returned promise settles when the key does (its cascade may still be in flight);
     * a failed re-fetch keeps the previous value and logs.
     */
    refresh: (key?: ScopeLoadKeys<S>) => Promise<void>;
    /** Keys currently re-fetching — selective refreshes and their cascade. */
    pending: ReadonlySet<ScopeLoadKeys<S>>;
    /**
     * Which slot the island is showing: `'loading'`, `'ready'`, or `'error'`. Aggregate —
     * the island resolves all-or-nothing, so there is no per-load phase to read. A stale
     * window is `'ready'` (content *is* on screen); {@link ScopeControls.isStale} is what
     * distinguishes it.
     */
    phase: IslandPhase;
    /**
     * Is the content on screen the *previous* resolution's? True only while kept content is
     * up: a `keepStale` island's stale window — between a re-resolve starting and the new
     * run committing — or a `loadingDelayMs` island's, until its deadline moves the loading
     * slot in. Dim it, badge it, disable its actions.
     *
     * Not a per-key flag: a selective `refresh(key)` also keeps its previous value
     * rendered, and that one is `pending` — which says *which* keys, where this says the
     * whole view belongs to a resolution that is no longer current.
     */
    isStale: boolean;
    /**
     * Which automatic attempt the island's `retry` policy has in flight — `1` for the first
     * one, and `0` whenever none is, the error slot included (a spent budget is not a retry
     * in progress). Always `0` on an island with no policy.
     *
     * Not a phase of its own: an island retrying is an island resolving, so `phase` reads
     * `'loading'` (or `'ready'` + `isStale` under `keepStale`) throughout. This is what a
     * loading slot switches on to say *why* it is still up.
     */
    retrying: number;
    /**
     * Re-resolve from scratch — the error slot's `retry`, as a verb the whole subtree can
     * reach, so a component can offer the affordance without being the error slot. The same
     * action as `refresh()` with no key. On an island with a `retry` policy this also resets
     * the automatic budget: a human asking again is new information.
     */
    retry: () => void;
};

const emptyPending: ReadonlySet<string> = new Set();
const noopSubscribe = () => () => {};
const emptySnapshot = () => emptyPending;
const inertStatus: IslandStatus = { phase: 'loading', isStale: false, retrying: 0 };
const inertStatusSnapshot = () => inertStatus;

/**
 * Read the nearest island's controls for a scope — imperative refresh (whole-scope or
 * per-key) and retry, plus what the island is doing right now: its `phase`, whether the
 * content is `isStale`, and the live set of keys currently re-fetching. Keyed by the
 * **scope**, like {@link useScope}: a descendant imports the scope, never the island
 * component.
 *
 * Throws when no island for the scope is above the calling component.
 */
export function useScopeControls<S extends Scope<any>>(scope: S): ScopeControls<S> {
    const channel = controlsChannels.get(scope);
    const controller = useContext(channel ?? noControlsChannel);
    // Hooks run unconditionally (rules of hooks) — fall back to an inert store when no
    // controller is above; the errors below then take over.
    const pending = useSyncExternalStore(
        controller ? controller.subscribePending : noopSubscribe,
        controller ? controller.getPending : emptySnapshot,
        controller ? controller.getPending : emptySnapshot,
    );
    const status = useSyncExternalStore(
        controller ? controller.subscribeStatus : noopSubscribe,
        controller ? controller.getStatus : inertStatusSnapshot,
        controller ? controller.getStatus : inertStatusSnapshot,
    );
    if (!channel) {
        throw new Error(
            `useScopeControls(${describeScope(scope)}): no island uses this scope — pass the ` +
                `scope an island() was built from.`,
        );
    }
    if (!controller) {
        throw new Error(
            `useScopeControls(${describeScope(scope)}): no island for this scope is above the ` +
                `current component — render it inside the island's subtree.`,
        );
    }
    return {
        refresh: controller.refresh as ScopeControls<S>['refresh'],
        pending: pending as ReadonlySet<ScopeLoadKeys<S>>,
        phase: status.phase,
        isStale: status.isStale,
        retrying: status.retrying,
        retry: controller.retry,
    };
}
