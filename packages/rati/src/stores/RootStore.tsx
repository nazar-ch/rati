import { observable, runInAction } from 'mobx';
import React, { type Context, useEffect } from 'react';
import { WebRouterStore } from './WebRouterStore';
import { sleep } from '../common/stuff';
import { observer } from 'mobx-react-lite';

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
        options: RootStoreOptions = {}
    ) {
        if (options.isReady) this._isReady = true;
    }

    get globalStores() {
        return this.stores;
    }

    /**
     * Blocks the app from rendering before rehydrating the stores
     */
    get isReady() {
        return this._isReady;
    }

    @observable protected accessor _isReady: boolean = false;

    /**
     * Stores initialization and rehydration. Should be called before rendering app components
     */
    async init() {
        // TODO: hydrate stores
        await mockHydration();

        runInAction(() => {
            this._isReady = true;
        });
    }

    StoresContext = GenericStoresContext as Context<typeof this.stores | null>;

    useStores = createUseStoresHook(this.StoresContext);

    StoresProvider = observer(({ children }: { children: React.ReactNode }) => {
        useEffect(() => {
            if (this._isReady) return;
            this.init().catch(console.error);
        }, []);

        if (!this._isReady) return null;

        return (
            <this.StoresContext.Provider value={this.stores}>
                {children}
            </this.StoresContext.Provider>
        );
    });
}

async function mockHydration() {
    await sleep(5);
}

export const GenericStoresContext = React.createContext<GlobalStores | null>(null);

function createUseStoresHook<T extends unknown>(context: Context<T | null>) {
    return function () {
        const stores = React.useContext(context);
        if (!stores) {
            throw new Error('Store context is undefined. Use StoreProvider.');
        }
        return stores;
    };
}

export interface GlobalStores {
    router?: WebRouterStore;
}

export const useGenericStores = createUseStoresHook(GenericStoresContext);

export function useWebRouter() {
    const { router } = useGenericStores();

    if (!router || !(router instanceof WebRouterStore)) {
        throw new Error('Please add WebRouter to the global stores to use link components');
    }

    return router;
}
