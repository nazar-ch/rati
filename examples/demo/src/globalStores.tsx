import { RootStore, WebRouterStore, type GlobalStores } from 'rati';
import { routes } from './routes';
export class GlobalStoresContainer implements GlobalStores {
    router = new WebRouterStore(this, routes);
}

const globalStoresContainer = new GlobalStoresContainer();

export const rootStore = new RootStore(globalStoresContainer);
export const { useStores, globalStores } = rootStore;
