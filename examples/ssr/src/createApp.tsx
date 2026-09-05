import {
    createHeadStore,
    createRouter,
    HeadProvider,
    type HeadStore,
    type History,
    type Router,
    RouterOutlet,
    RouterProvider,
    type RouterHydratedState,
} from 'rati';
import { type Hydration, HydrationProvider } from 'rati/ssr';

import { RegionContext } from './appContext';
import { Layout } from './components/Layout';
import { routes } from './routes';

export interface CreateAppOptions {
    history: History;
    hydratedState?: RouterHydratedState | undefined;
    /**
     * Hydration wiring, both directions: the server passes the collector half
     * (`collect`/`collectError`), the client passes the payload half (`data`/`seeds`)
     * read back with `readHydration()`.
     */
    hydration?: Hydration | undefined;
}

export interface CreatedApp {
    router: Router;
    App: () => React.ReactElement;
    /** Per-app-instance head store — the server reads it after prerender (headTags). */
    head: HeadStore;
}

/**
 * Build a fresh app instance. The server creates one per request (memory history);
 * the client creates one at hydration time (browser history seeded from the embedded
 * snapshot). Everything request-scoped — router, head store — is created here, never
 * at module level, so concurrent server renders can't share state.
 */
export function createApp({ history, hydratedState, hydration }: CreateAppOptions): CreatedApp {
    const router = createRouter(routes, { history, hydratedState });
    const head = createHeadStore({
        defaultTitle: 'rati feature gallery',
        titleTemplate: (title) => `${title} · rati gallery`,
    });

    function App() {
        return (
            <RouterProvider router={router}>
                <HeadProvider store={head}>
                    {/* Region is injected here (server and client alike) and read inside
                        the product scope via hook(() => useContext(RegionContext)). */}
                    <RegionContext.Provider value="US">
                        <HydrationProvider {...hydration}>
                            <Layout>
                                <RouterOutlet />
                            </Layout>
                        </HydrationProvider>
                    </RegionContext.Provider>
                </HeadProvider>
            </RouterProvider>
        );
    }

    return { router, App, head };
}
