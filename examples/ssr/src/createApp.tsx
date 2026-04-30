import {
    type History,
    RootStore,
    RootStoreProvider,
    Router,
    type WebRouterHydratedState,
    WebRouterStore,
} from 'rati';
import { routes } from './routes';

export interface CreateAppOptions {
    history: History;
    hydratedState?: WebRouterHydratedState | undefined;
}

export interface CreatedApp {
    router: WebRouterStore<typeof routes>;
    root: RootStore<{ router: WebRouterStore<typeof routes> }>;
    App: () => React.ReactElement;
}

/**
 * Build a fresh app instance. The server creates one per request (memory
 * history); the client creates one at hydration time (browser history seeded
 * from the snapshot the server embedded in the HTML).
 */
export function createApp({ history, hydratedState }: CreateAppOptions): CreatedApp {
    const router = new WebRouterStore({}, routes, { history, hydratedState });
    const root = new RootStore({ router }, { isReady: true });

    function App() {
        return (
            <RootStoreProvider rootStore={root}>
                <Router />
            </RootStoreProvider>
        );
    }

    return { router, root, App };
}
