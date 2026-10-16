import { createContext, useContext, useSyncExternalStore, type Context } from 'react';

import { describeScope } from './channel.js';
import type { IslandPhase, IslandStatus, RefreshController } from './refresh.js';

import type { Scope, ScopeLoadKeys } from '../scope/scope.js';

/*
    The controls channel behind `useScopeControls`: beside the value channel (channel.ts),
    which publishes what an island resolved, it publishes verbs on the island instance. No
    promise or source leaks out to a component.
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
     * Re-resolves the whole scope, or with a key only that promise load: the previous value
     * stays rendered, an unchanged result (per `equals`) keeps it, and a changed one re-runs
     * its dependents. Settles when the key does; a failed re-fetch keeps the previous value.
     */
    refresh: (key?: ScopeLoadKeys<S>) => Promise<void>;
    /** Keys currently re-fetching — selective refreshes and their cascade. */
    pending: ReadonlySet<ScopeLoadKeys<S>>;
    /**
     * Which slot the island is showing: `'loading'`, `'ready'`, or `'error'`. Aggregate —
     * the island resolves all-or-nothing, so there is no per-load phase to read. A stale
     * window is `'ready'` (content IS on screen); {@link ScopeControls.isStale} is what
     * distinguishes it.
     */
    phase: IslandPhase;
    /**
     * Is the content on screen the PREVIOUS resolution's? True only while kept content is up —
     * a `keepStale` window, or a `loadingDelayMs` one until its deadline. Dim it, badge it. A
     * selective `refresh(key)` reports in `pending` instead.
     */
    isStale: boolean;
    /**
     * Which automatic attempt the `retry` policy has in flight — `1` for the first, `0` when
     * none, the error slot included. No phase of its own: `phase` reads `'loading'`
     * throughout, and a loading slot switches on this to say WHY it is up.
     */
    retrying: number;
    /**
     * Re-resolves from scratch — the error slot's `retry` as a verb the whole subtree can
     * reach, the same action as `refresh()` with no key. With a `retry` policy it also resets
     * the automatic budget.
     */
    retry: () => void;
};

const emptyPending: ReadonlySet<string> = new Set();
const noopSubscribe = () => () => {};
const emptySnapshot = () => emptyPending;
const inertStatus: IslandStatus = { phase: 'loading', isStale: false, retrying: 0 };
const inertStatusSnapshot = () => inertStatus;

/**
 * Reads the nearest island's controls for a scope: refresh and retry, plus its `phase`,
 * `isStale`, `retrying` and `pending`. Keyed by the scope, like {@link useScope}. Throws when
 * no island for the scope is above the caller.
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
