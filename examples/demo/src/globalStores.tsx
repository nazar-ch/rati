import { createUseStoresHook, RouterStore, type GlobalStores } from 'rati';
import { routes } from './routes';
export class GlobalStoresContainer implements GlobalStores {
    router = new RouterStore(this, routes);
}

export const useStores = createUseStoresHook<GlobalStoresContainer>();
