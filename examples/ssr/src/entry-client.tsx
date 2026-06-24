import { hydrateRoot } from 'react-dom/client';
import { createBrowserHistory } from 'rati';
import { type AppHydrationState, createApp } from './createApp';

declare global {
    interface Window {
        __RATI_STATE__: AppHydrationState | null;
    }
}

const state = window.__RATI_STATE__ ?? null;
const { App } = createApp({
    history: createBrowserHistory(),
    hydratedState: state?.router,
    islandData: state?.islands,
});

hydrateRoot(document.getElementById('root')!, <App />);
