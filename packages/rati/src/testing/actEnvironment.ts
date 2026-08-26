/*
    Scoped IS_REACT_ACT_ENVIRONMENT handling for the harness's own `act` calls.

    The entry used to set the global flag permanently on first mount ("defensively"), but a
    permanent set is a real policy change for the consuming suite: a runner that deliberately
    leaves the flag unset (so non-act-driven async updates — editor portals, timers awaited
    via waitFor — don't warn) would inherit it forever after the first rati/testing mount.
    Instead, each helper sets the flag for the duration of its own `act` and restores the
    previous value after — the same save/set/restore RTL does around its `act` calls. A
    test's own bare `act(…)` drives still need the runner's environment (RTL sets one up on
    import; or set the global yourself), exactly as documented.

    Overlap note: React forbids overlapping `act` calls, so the save/restore pairs nest but
    never interleave — the previous value is always the right thing to restore.
*/

interface ActEnvironmentGlobal {
    IS_REACT_ACT_ENVIRONMENT?: boolean | undefined;
}

/** Run `fn` (which awaits an async `act`) with the act flag set, restoring it after. */
export async function withActEnvironment<T>(fn: () => Promise<T>): Promise<T> {
    const scope = globalThis as ActEnvironmentGlobal;
    const previous = scope.IS_REACT_ACT_ENVIRONMENT;
    scope.IS_REACT_ACT_ENVIRONMENT = true;
    try {
        return await fn();
    } finally {
        scope.IS_REACT_ACT_ENVIRONMENT = previous;
    }
}

/** The synchronous twin, for a sync `act` (teardown's unmount). */
export function withActEnvironmentSync<T>(fn: () => T): T {
    const scope = globalThis as ActEnvironmentGlobal;
    const previous = scope.IS_REACT_ACT_ENVIRONMENT;
    scope.IS_REACT_ACT_ENVIRONMENT = true;
    try {
        return fn();
    } finally {
        scope.IS_REACT_ACT_ENVIRONMENT = previous;
    }
}
