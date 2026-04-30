import './App.css';
import { rootStore } from './globalStores';
import { Router as RatiRouter } from 'rati';

export function App() {
    return (
        <rootStore.StoresProvider>
            <RatiRouter />
        </rootStore.StoresProvider>
    );
}
