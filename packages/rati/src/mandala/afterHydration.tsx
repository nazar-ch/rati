import { useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';

/*
    The render-side half of `ssr: false`: uSES reads `getServerSnapshot` in the server render
    AND the hydration pass, so both render the fallback and nothing suspends during hydration;
    the client snapshot then resolves the tree, and a client-only mount renders it at once.
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
