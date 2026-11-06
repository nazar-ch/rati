import { act } from 'react';

import { withActEnvironment } from './actEnvironment.js';

/*
    `act` comes from `react`, since this entry takes no `@testing-library/react`. The act flag is
    scoped around this helper's own call (./actEnvironment), so `flush()` works in a suite that
    leaves the global unset; a test's own bare `act` needs the runner's environment.
*/

/**
 * Awaits `times` empty act-flushed microtask turns: React's retry after a settle is not
 * synchronous with the resolving `act`, and each re-suspended level needs one. Prefer a
 * FIXED count over a poll, which hides a regression.
 *
 * ```ts
 * source.setReady('live');
 * await flush();
 * ```
 */
export async function flush(times = 1): Promise<void> {
    for (let i = 0; i < times; i++) await withActEnvironment(() => act(async () => {}));
}
