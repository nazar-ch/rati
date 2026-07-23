import { act } from 'react';
import { withActEnvironment } from './actEnvironment';

/*
    `act` is imported from `react` (not `react-dom/test-utils`, which is gone in React 19,
    nor `@testing-library/react`, which the entry does not depend on). Everything in
    `rati/testing` is test-environment-only; the act flag is scoped around this helper's own
    `act` call (see ./actEnvironment), so `flush()` works even in a suite that deliberately
    leaves the global unset. A test's own bare `act(…)` drives still need the runner's
    environment (`@testing-library/react` sets one up on import, or set
    `globalThis.IS_REACT_ACT_ENVIRONMENT = true`).
*/

/**
 * Await `times` empty act-flushed microtask turns — the act idiom hand-inlined 100+ times
 * across rati's own suites (`await act(async () => {})`).
 *
 * One flush drains the microtasks an already-settled update queued. Suspense makes more
 * than one necessary: React's retry after a promise settles is not synchronous with the
 * resolving `act` (see `src/__tests__/suspense-situations.md` S2), and a waterfall that
 * re-suspends one level deeper needs one flush per level. Prefer a *fixed* count over a
 * poll-until-green loop — a fixed count that stops passing is a real regression; a poll
 * hides it.
 *
 * ```ts
 * await source.setReady('live');   // or resolve a deferred, fire a refresh, …
 * await flush();                    // let the Suspense retry land
 * expect(handle.slot()).toBe('content');
 * ```
 */
export async function flush(times = 1): Promise<void> {
    for (let i = 0; i < times; i++) await withActEnvironment(() => act(async () => {}));
}
