import React, { type Context, useEffect, useState, useSyncExternalStore } from 'react';
import { WebRouterStore } from '../router/store';
import { sleep } from '../util/utils';

export interface RootStoreOptions {
    /**
     * Skip the initial async hydration step and render children immediately.
     * Used by server rendering, where stores are constructed fresh per request
     * and there is nothing to rehydrate, and by the SSR client entry, where
     * the rendered HTML is already in place and `init()` running asynchronously
     * would cause a hydration mismatch.
     */
    isReady?: boolean;
}

export class RootStore<T extends GlobalStores> {
    constructor(
        public stores: T,
        options: RootStoreOptions = {},
    ) {
        if (options.isReady) this._isReady = true;
    }

    /**
     * Blocks the app from rendering before rehydrating the stores
     */
    get isReady() {
        return this._isReady;
    }

    protected _isReady: boolean = false;

    /**
     * Stores initialization and rehydration. Should be called before rendering app components
     */
    async init() {
        // TODO: hydrate stores
        await mockHydration();
        this._isReady = true;
    }
}

export function RootStoreProvider({
    rootStore,
    children,
}: {
    rootStore: RootStore<any>;
    children: React.ReactNode;
}) {
    // `isReady` is a one-shot latch (false → true after init), read only here — plain
    // React state is enough, no external store / observer needed.
    const [ready, setReady] = useState(rootStore.isReady);

    useEffect(() => {
        if (rootStore.isReady) {
            setReady(true);
            return;
        }
        rootStore
            .init()
            .then(() => setReady(true))
            .catch(console.error);
    }, [rootStore]);

    if (!ready) return null;

    return (
        <GenericStoresContext.Provider value={rootStore.stores}>
            {children}
        </GenericStoresContext.Provider>
    );
}

async function mockHydration() {
    await sleep(5);
}

export const GenericStoresContext = React.createContext<GlobalStores | null>(null);

export function createUseStoresHook<T extends GlobalStores = never>() {
    return function () {
        const stores = React.useContext(GenericStoresContext as Context<T | null>);
        if (!stores) {
            throw new Error('Store context is undefined. Use StoreProvider.');
        }
        return stores;
    };
}

export interface GlobalStores {
    router?: WebRouterStore;
}

/** @internal */
export const useGenericStores = createUseStoresHook<GlobalStores>();

const noopSubscribe = () => () => {};
const noopGetSnapshot = () => 0;

/** @internal */
export function useWebRouter() {
    const { router } = useGenericStores();
    const webRouter = router instanceof WebRouterStore ? router : null;

    // Subscribe so any component reading the router (Link, Router, app code) re-renders
    // on navigation — this replaces the old mobx `observer` wrapping. A no-op
    // subscription when the router isn't configured keeps the rules of hooks intact;
    // the throw below turns that into a clear error.
    useSyncExternalStore(
        webRouter?.subscribe ?? noopSubscribe,
        webRouter?.getSnapshot ?? noopGetSnapshot,
        webRouter?.getSnapshot ?? noopGetSnapshot,
    );

    if (!webRouter) {
        throw new Error('Please add WebRouter to the global stores to use link components');
    }

    return webRouter;
}
