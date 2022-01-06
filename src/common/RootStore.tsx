import { makeObservable, observable, runInAction } from 'mobx';
import React, { FC, Context } from 'react';
import { WebRouter } from '../stores/WebRouter';
import { createLinkComponent } from './GenericLink';
import { sleep } from './stuff';
export class RootStore<T extends DefaultStores> {
    constructor(public stores: T) {
        makeObservable(this);
    }

    globalStores = this.stores;

    @observable isReady: boolean = false;

    async init() {
        // TODO: hydrate stores

        // FIXME: remove
        await sleep(100);
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

    Link = createLinkComponent<T['router']['routes']>();
}

export const GenericStoresContext = React.createContext<DefaultStores | null>(null);

function createUseStoresHook<T extends DefaultStores>(context: Context<T | null>) {
    return function () {
        const stores = React.useContext(context);
        if (!stores) {
            throw new Error('Store context is undefined. Use StoreProvider.');
        }
        return stores;
    };
}

type DefaultStores = {
    router: WebRouter;
};

export const useGenericStores = createUseStoresHook(GenericStoresContext);

type routes = InstanceType<typeof WebRouter>['routes'];
