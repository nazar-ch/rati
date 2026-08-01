import { act, type ComponentType, type ReactNode } from 'react';
import { createMemoryHistory, type History } from '../router/history';
import { RouterProvider } from '../router/RouterProvider';
import { RouterOutlet } from '../router/RouterOutlet';
import { RouterStore, type RouterHydratedState } from '../router/store';
import type { GenericRouteType } from '../router/route';
import { mountTree, visibleText, type MountedTree } from './dom';

/*
    createTestRouter — memory history + router + the RouterProvider wiring, rendered and
    disposed for you. Replaces the `createMemoryHistory` / `createRouter` / provider /
    `<RouterOutlet>` dance inlined across ~20 router test files (and the fuzz
    routerHarness's core), and gives a real router so `<Link>` works under test with no
    `vi.mock('rati')`.

    Memory history, not the browser's: back()/forward() traverse its real entry stack and emit
    synchronously (matching SSR and the fuzz model). Scroll restoration is off — jsdom has no
    layout, and it would fire a rAF + window.scrollTo per navigation. The history leaks
    listeners if nobody disposes it (the RF-01 lesson), so cleanup() detaches it through the
    mount's dispose hook.

    App stores are not this helper's business (rati has no stores container — an app's store
    graph is app code): a suite whose components read app stores passes its own provider via
    `wrapper`, and it renders inside the router context.
*/

/** Options for {@link createTestRouter}. */
export interface CreateTestRouterOptions {
    /** Initial URL for the memory history. Defaults to `/`. */
    url?: string;
    /** State attached to the initial history entry (readable via `router.state`). */
    state?: unknown;
    /**
     * What to render in the router context. Defaults to `<RouterOutlet />` (the app's
     * route table). Pass a custom tree to drive components that read the router — a page
     * with `<Link>`s, say — e.g. `ui: <RouterOutlet Loading={…} />` or `ui: <MyNav />`.
     */
    ui?: ReactNode;
    /**
     * App-provided context around `ui`, rendered *inside* the router provider — the seam
     * for an app's own stores/DI provider (`wrapper: AppStoresWrapper`).
     */
    wrapper?: ComponentType<{ children?: ReactNode }>;
    /** Mount the route table under a basename (forwarded to the router). */
    basename?: string;
    /** Seed the router from a dehydrated navigation (forwarded to the router) — the
     *  SSR client path, for pins like redirect replay on hydration. */
    hydratedState?: RouterHydratedState;
}

/** The handle {@link createTestRouter} returns. */
export interface TestRouter extends MountedTree {
    /** The live router (the concrete store — a test may reach internals). Navigate,
     *  read `activeRoute`/`path`, or spy on it. */
    readonly router: RouterStore;
    /** Its memory history — push/replace/go directly, or seed more entries. */
    readonly history: History;
    /** What the router's container says — see {@link visibleText}. */
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

export async function createTestRouter(
    routes: readonly GenericRouteType[],
    options: CreateTestRouterOptions = {},
): Promise<TestRouter> {
    const url = options.url ?? '/';
    const history = createMemoryHistory({ url });
    // createMemoryHistory takes only a url; a replace swaps the initial entry in place —
    // before the store listens — so the store's first setPath reads the seeded state.
    if (options.state !== undefined) history.replace(url, options.state);

    const router = new RouterStore(routes, {
        history,
        scrollRestoration: false,
        ...(options.basename !== undefined && { basename: options.basename }),
        ...(options.hydratedState !== undefined && { hydratedState: options.hydratedState }),
    });

    const Wrapper = options.wrapper;
    const wrap = (node: ReactNode) => (
        <RouterProvider router={router}>
            {Wrapper ? <Wrapper>{node}</Wrapper> : node}
        </RouterProvider>
    );
    const mount = await mountTree(wrap(options.ui ?? <RouterOutlet />), () => router.dispose());

    return {
        ...mount,
        router,
        history,
        text: () => visibleText(mount.container),
        navigate: (to) => act(async () => router.navigate(to)),
        back: () => act(async () => history.back()),
        forward: () => act(async () => history.forward()),
        // Re-wrap so a re-render keeps the router provider (bare mount.rerender drops it).
        rerender: (next) => mount.rerender(wrap(next)),
        dispose: mount.unmount,
    };
}
