import { useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';

/*
    "Not before the client has hydrated" — the render-side half of the island-level
    `ssr: false` opt-out (see MandalaConfig.ssr).

    The gate is `useSyncExternalStore`'s third argument. React reads `getServerSnapshot`
    in two places: the server render, *and* the client's hydration pass — that pairing is
    the hook's whole purpose, and it is exactly the pairing the opt-out needs:

      - server render      → fallback (the loading slot). No Step renders, so no load
                             starts and the collector records nothing.
      - hydration pass     → fallback again, byte-identical to the HTML. Nothing suspends
                             *during* hydration, which is what would have made React throw
                             the boundary away and client-render it (a recoverable error).
      - after hydration    → the store snapshot differs, uSES re-renders, the tree
                             resolves as an ordinary post-mount update.
      - client-only mount  → `getSnapshot` from the first render, so children render
                             immediately: no extra frame, the option reads as a no-op.

    Nothing here is a real external store — the value never changes. The two snapshots
    differ on purpose, and React's own render phase is what picks between them.
*/

// Stable identities: uSES re-subscribes when `subscribe` changes, and requires a snapshot
// getter that returns a referentially stable value.
const subscribe = () => () => {};
const onClient = () => true;
const notYet = () => false;

export function AfterHydration({
    fallback,
    children,
}: {
    fallback: ReactNode;
    children: ReactNode;
}) {
    return useSyncExternalStore(subscribe, onClient, notYet) ? children : fallback;
}
