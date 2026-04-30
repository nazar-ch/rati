import { hydrateRoot } from 'react-dom/client';
import { createBrowserHistory, type WebRouterHydratedState } from 'rati';
import { createApp } from './createApp';

declare global {
    interface Window {
        __RATI_STATE__: WebRouterHydratedState | null;
    }
}

const hydratedState = window.__RATI_STATE__ ?? undefined;
const { App } = createApp({
    history: createBrowserHistory(),
    hydratedState,
});

hydrateRoot(document.getElementById('root')!, <App />);
