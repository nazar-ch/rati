import {
    type History,
    RootStore,
    RootStoreProvider,
    Router,
    type RouterHydratedState,
    RouterStore,
} from 'rati';
import { type HydrationData, HydrationProvider } from 'rati/ssr';
import { RegionContext } from './appContext';
import { Layout } from './components/Layout';
import { routes } from './routes';

/**
 * The snapshot embedded in the SSR HTML and fed back to {@link createApp} on the
 * client: the router's routing state plus the island engine's dehydrated promise
 * values, so the first client render matches the server HTML without re-fetching.
 */
export interface AppHydrationState {
    router: RouterHydratedState;
    islands: HydrationData;
}

export interface CreateAppOptions {
    history: History;
    hydratedState?: RouterHydratedState | undefined;
    /** Client: server-collected island data to rehydrate from, without re-running loads. */
    islandData?: HydrationData | undefined;
    /** Server: collector that records resolved island promise values during the prerender. */
    collectIslandData?: ((mandalaId: string, key: string, value: unknown) => void) | undefined;
}

export interface CreatedApp {
    router: RouterStore<typeof routes>;
    root: RootStore<{ router: RouterStore<typeof routes> }>;
    App: () => React.ReactElement;
}

/**
 * Build a fresh app instance. The server creates one per request (memory
 * history); the client creates one at hydration time (browser history seeded
 * from the snapshot the server embedded in the HTML).
 *
 * The mandala engine resolves a route's scope during the server render and
 * dehydrates its promise values through `HydrationProvider` (rati/ssr). The
 * provider is mounted on both the server and the client so the trees stay identical
 * (and each island's `useId` stable): the server passes `collect`, the client
 * passes the collected `data`.
 */
export function createApp({
    history,
    hydratedState,
    islandData,
    collectIslandData,
}: CreateAppOptions): CreatedApp {
    const router = new RouterStore({}, routes, { history, hydratedState });
    const root = new RootStore({ router }, { isReady: true });

    function App() {
        return (
            <RootStoreProvider rootStore={root}>
                {/* Region is injected here (server and client alike) and read inside the
                    product scope via hook(() => useContext(RegionContext)). */}
                <RegionContext.Provider value="US">
                    <HydrationProvider collect={collectIslandData} data={islandData}>
                        <Layout>
                            <Router />
                        </Layout>
                    </HydrationProvider>
                </RegionContext.Provider>
            </RootStoreProvider>
        );
    }

    return { router, root, App };
}
