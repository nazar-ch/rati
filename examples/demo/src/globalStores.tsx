import { RootStore, WebRouter } from 'rati';
import { routes } from './routes';

const stores = {
    webRouter: new WebRouter(this, routes),
};

export const rootStore = new RootStore(stores);
export const { useStores, globalStores } = rootStore;
