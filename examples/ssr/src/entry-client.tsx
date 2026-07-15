import { createRoot, hydrateRoot } from 'react-dom/client';
import { createBrowserHistory } from 'rati';
import { readHydration } from 'rati/ssr';
import { createApp } from './createApp';
// The app's CSS enters through its entry, the ordinary Vite way: the build hashes it
// alongside this module and the manifest lists it, which is how the server knows to
// link it (virtual:rati/assets → styleTags). Dev injects it through JS instead.
import './styles.css';

// The server serialized the routing snapshot + island data into an inert JSON script
// tag; readHydration() parses it (null on a client-only boot or a version mismatch —
// the app then simply resolves from scratch).
const state = readHydration();

const { App } = createApp({
    history: createBrowserHistory(),
    hydratedState: state?.router,
    hydration: state ? { data: state.data, seeds: state.seeds } : undefined,
});

const root = document.getElementById('root')!;

// No payload, no server HTML: this is the CSR shell rati/server falls back to when a
// render throws (see the /fallback page), or a plain client-only boot. Hydrating an
// empty root against a tree that renders something is a mismatch React would report and
// then recover from by doing this anyway — so do this.
if (state) hydrateRoot(root, <App />);
else createRoot(root).render(<App />);
