import './App.css';
import { rootStore } from './globalStores';
import { RouterComponent } from 'rati';

export function App() {
    return (
        <rootStore.StoresProvider stores={rootStore.stores}>
            <RouterComponent
                // DefaultWrapper={AuthGuardedContentWrapper}
                router={rootStore.stores.webRouter}
            />
        </rootStore.StoresProvider>
    );
}
