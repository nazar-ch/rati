import { makeObservable, observable, runInAction } from 'mobx';
import React, { FC, Context } from 'react';
import { GlobalStore } from '../main';
import { WebRouter } from '../stores/WebRouter';
import { createLinkComponent } from './GenericLink';
import { sleep } from './stuff';

export class RootStore<T extends GlobalStores> {
    constructor(public stores: T) {
        makeObservable(this);
    }

    globalStores = this.stores;

    @observable isReady: boolean = false;

    async init() {
        // TODO: hydrate stores

        runInAction(() => {
            this.isReady = true;
        });
    }

    StoresContext = GenericStoresContext as Context<T | null>;

    useStores = createUseStoresHook(this.StoresContext);

    StoresProvider = (function (StoresContext) {
        const Provider: FC<{
            // TODO: maybe type stores better
            stores?: any;
        }> = ({ children, stores }) => {
            return <StoresContext.Provider value={stores}>{children}</StoresContext.Provider>;
        };
        return Provider;
    })(this.StoresContext);
}

export const GenericStoresContext = React.createContext<GlobalStores | null>(null);

function createUseStoresHook<T extends GlobalStores>(context: Context<T | null>) {
    return function () {
        const stores = React.useContext(context);
        if (!stores) {
            throw new Error('Store context is undefined. Use StoreProvider.');
        }
        return stores;
    };
}

type GlobalStores = Record<string, GlobalStore<GlobalStores> & { webRouter?: WebRouter }>;

export const useGenericStores = createUseStoresHook(GenericStoresContext);

export function useWebRouter() {
    const { webRouter } = useGenericStores();

    if (!webRouter || !(webRouter instanceof WebRouter)) {
        throw new Error('Please add WebRouter to the global stores to use link components');
    }

    return webRouter;
}
