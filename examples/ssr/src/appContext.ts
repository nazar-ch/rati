import { createContext } from 'react';

/**
 * An app-injected dependency, read by the product scope's `hook(() =>
 * useContext(RegionContext))` load — why rati needs no `env` parameter. `createApp`
 * provides it on the server and the client.
 */
export const RegionContext = createContext<'US' | 'EU'>('US');
