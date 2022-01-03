import { makeObservable, observable, runInAction } from 'mobx';
import React, { FC } from 'react';
import { sleep } from './stuff';
export class Rati<T> {
    constructor(public stores: T) {
        makeObservable(this);
    }

    globalStores = this.stores;

    @observable isReady: boolean = false;
    StoresContext = React.createContext<T | null>(null);

    async init() {
        // TODO: hydrate stores

        // FIXME: remove
        await sleep(100);
        runInAction(() => {
            this.isReady = true;
        });
    }

    useStores = (function(context) {
        return function() {
            const stores = React.useContext(context);
            if (!stores) {
                throw new Error('Store context is undefined. Use StoreProvider.');
            }
            return stores;
        };
    })(this.StoresContext);

    StoresProvider = (function(StoresContext) {
        const Provider: FC<{
            // TODO: maybe type stores better
            stores?: any;
        }> = ({ children, stores }) => {
            return <StoresContext.Provider value={stores}>{children}</StoresContext.Provider>;
        };
        return Provider;
    })(this.StoresContext);
}
