import { act, type ReactNode } from 'react';
import { createMemoryHistory, type History } from '../router/history';
import { RouterStore, type RouterHydratedState } from '../router/store';
import { Router } from '../router/Router';
import { RootStore, RootStoreProvider, type GlobalStores } from '../stores/RootStore';
import type { GenericRouteType } from '../router/route';
import { mountTree, type MountedTree } from './dom';
import type { PartialStores } from './stores';

/*
    createTestRouter — memory history + RouterStore + the RootStoreProvider wiring, rendered
    and disposed for you. Replaces the `createMemoryHistory` / `new RouterStore` / provider /
    `<Router>` dance inlined across ~20 router test files (and the fuzz routerHarness's core),
    and gives a real router so `<Link>` works under test with no `vi.mock('rati')`.

    Memory history, not the browser's: back()/forward() traverse its real entry stack and emit
    synchronously (matching SSR and the fuzz model). Scroll restoration is off — jsdom has no
    layout, and it would fire a rAF + window.scrollTo per navigation. The history leaks
    listeners if nobody disposes it (the RF-01 lesson), so cleanup() detaches it through the
    mount's dispose hook.
*/

/** Options for {@link createTestRouter}. */
export interface CreateTestRouterOptions<S extends GlobalStores> {
    /** Initial URL for the memory history. Defaults to `/`. */
    url?: string;
    /** State attached to the initial history entry (readable via `router.state`). */
    state?: unknown;
    /**
     * What to render in the router + stores context. Defaults to `<Router />` (the app's
     * route table). Pass a custom tree to drive components that read the router — a page with
     * `<Link>`s, say — e.g. `ui: <Router Loading={…} />` or `ui: <MyNav />`.
     */
    ui?: ReactNode;
    /** Extra stores merged alongside the router, for a tree that reads app stores too —
     *  each store itself partial-able (see {@link PartialStores}). */
    stores?: PartialStores<S>;
    /** Mount the route table under a basename (forwarded to the RouterStore). */
    basename?: string;
    /** Seed the router from a dehydrated navigation (forwarded to the RouterStore) — the
     *  SSR client path, for pins like redirect replay on hydration. */
    hydratedState?: RouterHydratedState;
}

/** The handle {@link createTestRouter} returns. */
export interface TestRouter extends MountedTree {
    /** The live RouterStore — navigate, read `activeRoute`/`path`, or spy on it. */
    readonly router: RouterStore<readonly GenericRouteType[]>;
    /** Its memory history — push/replace/go directly, or seed more entries. */
    readonly history: History;
    /** The container's trimmed `textContent`. */
    text(): string | null;
    /** `router.navigate(to)`, settled. */
    navigate(to: string): Promise<void>;
    /** Step back through the entry stack (`history.back()`), settled. */
    back(): Promise<void>;
    /** Step forward through the entry stack (`history.forward()`), settled. */
    forward(): Promise<void>;
    /** Unmount and dispose the router (detaching its history) — what `cleanup()` does for it. */
    dispose(): void;
}

export async function createTestRouter<S extends GlobalStores = GlobalStores>(
    routes: readonly GenericRouteType[],
    options: CreateTestRouterOptions<S> = {},
): Promise<TestRouter> {
    const url = options.url ?? '/';
    const history = createMemoryHistory({ url });
    // createMemoryHistory takes only a url; a replace swaps the initial entry in place —
    // before the store listens — so the store's first setPath reads the seeded state.
    if (options.state !== undefined) history.replace(url, options.state);

    const router = new RouterStore({}, routes, {
        history,
        scrollRestoration: false,
        ...(options.basename !== undefined && { basename: options.basename }),
        ...(options.hydratedState !== undefined && { hydratedState: options.hydratedState }),
    });
    const stores = { ...options.stores, router } as S;
    const root = new RootStore(stores, { isReady: true });

    const wrap = (node: ReactNode) => (
        <RootStoreProvider rootStore={root}>{node}</RootStoreProvider>
    );
    const mount = await mountTree(wrap(options.ui ?? <Router />), () => router.dispose());

    return {
        ...mount,
        router,
        history,
        text: () => mount.container.textContent?.trim() ?? null,
        navigate: (to) => act(async () => router.navigate(to)),
        back: () => act(async () => history.back()),
        forward: () => act(async () => history.forward()),
        // Re-wrap so a re-render keeps the router/stores provider (bare mount.rerender drops it).
        rerender: (next) => mount.rerender(wrap(next)),
        dispose: mount.unmount,
    };
}
