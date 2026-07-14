import { createContext, useContext } from 'react';
import type { HeadStore } from './store';

// Null default on purpose: falling back to a module-global store would mean concurrent
// server renders clobbering each other's heads. Requiring the provider keeps the
// one-store-per-tree rule structural instead of documentation.
export const HeadContext = createContext<HeadStore | null>(null);

export function useHeadStore(caller: string): HeadStore {
    const store = useContext(HeadContext);
    if (!store) {
        throw new Error(
            `[rati] ${caller} needs a <HeadProvider> above it. Mount one near the app root ` +
                `(on the server, create the head store per request and pass it in).`,
        );
    }
    return store;
}
