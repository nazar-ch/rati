import { createUseStoresHook, WebRouterStore, type GlobalStores } from 'rati';
import { routes } from './routes';
export class GlobalStoresContainer implements GlobalStores {
    router = new WebRouterStore(this, routes);
}

export const useStores = createUseStoresHook<GlobalStoresContainer>();
