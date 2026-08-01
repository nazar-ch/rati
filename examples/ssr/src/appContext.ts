import { createContext } from 'react';

/**
 * An app-injected dependency, read by a `hook()` load (see the product scope in
 * `routes.tsx`). A load pulls its inputs from React context this way — `hook(() =>
 * useContext(RegionContext))` — which is why rati needs no `env` parameter. The app
 * provides it once (in `createApp`), on both the server and the client.
 */
export const RegionContext = createContext<'US' | 'EU'>('US');
