/*
    Scoped IS_REACT_ACT_ENVIRONMENT for the harness's own `act` calls: each sets the flag for
    its `act` and restores the previous value, as RTL does, so a suite leaving it unset keeps its
    policy. `act` calls never overlap, so the save/restore pairs nest.
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
