import { hydrateRoot } from 'react-dom/client';
import { createBrowserHistory } from 'rati';
import { readHydration } from 'rati/ssr';
import { createApp } from './createApp';

// The server serialized the routing snapshot + island data into an inert JSON script
// tag; readHydration() parses it (null on a client-only boot or a version mismatch —
// the app then simply resolves from scratch).
const state = readHydration();

const { App } = createApp({
    history: createBrowserHistory(),
    hydratedState: state?.router,
    hydration: state ? { data: state.data, seeds: state.seeds } : undefined,
});

hydrateRoot(document.getElementById('root')!, <App />);
