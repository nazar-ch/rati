import { createContext, useContext, type Context } from 'react';
import type { Scope, ScopeProvidesOf } from '../scope/scope';
import { is } from '../util/utils';

// One value channel per mandala, holding whatever it provides — the resolved props by
// default, or the `.provide()` value when declared. Keyed by the *scope*: a descendant
// imports the scope (a data module), never the component that renders it — so there is no
// child→parent reference and no import cycle. Mandalas built from the same scope share
// one channel (get-or-create in createMandala), so the nearest one wins — ordinary React
// context semantics. The sentinel distinguishes "no provider above" from a provided value
// that is itself nullish.
const SCOPE_MISSING = Symbol('rati.scope-missing');
const scopeChannels = new WeakMap<object, Context<unknown>>();
// A human label per scope (the component's displayName), used only in error messages.
const scopeLabels = new WeakMap<object, string>();
const noScopeChannel = createContext<unknown>(SCOPE_MISSING);

// Get-or-create the value channel for a scope (shared across mandalas built from the same
// scope). Called by createMandala when wiring a new mandala component.
export function registerScopeChannel(scope: object): Context<unknown> {
    const channel = scopeChannels.get(scope) ?? createContext<unknown>(SCOPE_MISSING);
    scopeChannels.set(scope, channel);
    return channel;
}

// Record a readable identifier for a scope's read errors (best-effort: shared scopes keep
// the last mandala's label).
export function setScopeLabel(scope: object, label: string): void {
    scopeLabels.set(scope, label);
}

// A best-effort identifier for a scope in error messages: the rendering component's
// displayName when a mandala was built from the scope, else the scope's own load keys.
function describeScope(scope: object): string {
    const label = scopeLabels.get(scope);
    if (label) return label;
    const def = (scope as Scope).definition;
    const keys = is.object(def) ? Object.keys(def) : [];
    return keys.length ? `scope({ ${keys.join(', ')} })` : 'the given scope';
}

// The outcome of reading a scope's value channel — split so each caller applies its own
// policy and crafts its own message with the right identifier. `no-provider`: an island
// for the scope exists, but none is rendered above this component. `no-island`: no island
// uses this scope at all (a misuse). A hook (calls useContext), so callers invoke it
// unconditionally.
export type ScopeRead =
    | { status: 'value'; value: unknown }
    | { status: 'no-provider' }
    | { status: 'no-island' };

export function useScopeRead(scope: object): ScopeRead {
    const channel = scopeChannels.get(scope);
    const value = useContext(channel ?? noScopeChannel);
    if (!channel) return { status: 'no-island' };
    if (value === SCOPE_MISSING) return { status: 'no-provider' };
    return { status: 'value', value };
}

/**
 * Read the value an island provides to its subtree — the resolved props by default, or
 * the `.provide()` value when the scope declares one. The value is created and (for a
 * `.provide()` value) torn down by the island in lockstep with its sources, so a store
 * built over a grabbed resource never outlives that grab. Nearest island instance wins.
 *
 * Keyed by the **scope**: a descendant imports the scope (a data module), never the
 * island component that renders it — so there is no child→parent reference or import
 * cycle, and the type comes straight off the scope.
 *
 * Throws when no island for the scope is above — see {@link useOptionalScope} for the
 * non-throwing form.
 */
export function useScope<S extends Scope<any>>(scope: S): ScopeProvidesOf<S> {
    const read = useScopeRead(scope);
    switch (read.status) {
        case 'value':
            return read.value as ScopeProvidesOf<S>;
        case 'no-provider':
            throw new Error(
                `useScope(${describeScope(scope)}): no island for this scope is above the current ` +
                    `component — render it inside the island's subtree.`,
            );
        case 'no-island':
            throw new Error(
                `useScope(${describeScope(scope)}): no island uses this scope — pass the scope an ` +
                    `island() was built from.`,
            );
    }
}

/**
 * Optional form of {@link useScope}: returns `undefined` instead of throwing when no
 * island for the scope is above (the component renders standalone). Still throws when no
 * island uses the scope at all — that's a misuse, not an absent value.
 */
export function useOptionalScope<S extends Scope<any>>(scope: S): ScopeProvidesOf<S> | undefined {
    const read = useScopeRead(scope);
    switch (read.status) {
        case 'value':
            return read.value as ScopeProvidesOf<S>;
        case 'no-provider':
            return undefined;
        case 'no-island':
            throw new Error(
                `useOptionalScope(${describeScope(scope)}): no island uses this scope — pass the ` +
                    `scope an island() was built from.`,
            );
    }
}
