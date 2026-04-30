import { useState } from 'react';
import './App.css';
import { Router as RatiRouter, RootStore, RootStoreProvider } from 'rati';
import { GlobalStoresContainer } from './globalStores';

export function App() {
    const [rootStore] = useState(new RootStore(new GlobalStoresContainer()));

    return (
        <RootStoreProvider rootStore={rootStore}>
            <RatiRouter />
        </RootStoreProvider>
    );
}
