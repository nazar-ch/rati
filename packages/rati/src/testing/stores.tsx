import type { ReactNode } from 'react';
import { RootStore, RootStoreProvider, type GlobalStores } from '../stores/RootStore';
import { mountTree, type MountedTree } from './dom';

/*
    renderWithStores — mount a tree with a *partial* stores container, the shape ten Jnana
    component tests build by hand and inject through `GenericStoresContext.Provider` with an
    `as unknown as GlobalStores` cast. The cast dies here: the test hands a typed partial
    ("I provide only the two stores this component reads"), and the one sanctioned widening
    lives inside the helper.

    Reconcile note: this item's cut assumed the stores-container effort (StoresProvider /
    createStoresHook, `GenericStoresContext` internalized) had landed — it had not. What
    shipped is `RootStore` + `RootStoreProvider` + a still-public `GenericStoresContext` +
    `createUseStoresHook`. So the seam builds on that (a RootStore marked ready behind
    RootStoreProvider) rather than re-exposing anything, and stays a designed surface. See the
    effort README's DX-03 delta note.
*/

/** Options for {@link renderWithStores}. */
export interface RenderWithStoresOptions<S extends GlobalStores> {
    /** The stores this component reads — a typed partial of the app's stores. */
    stores?: Partial<S>;
}

/** The handle {@link renderWithStores} returns. */
export interface StoresHandle extends MountedTree {
    /** The container's trimmed `textContent`. */
    text(): string | null;
}

/**
 * Render `ui` under a stores container built from `stores`. Parameterize with the app's
 * stores type — `renderWithStores<AppStores>(ui, { stores: { a, b } })` — so the partial is
 * checked against the real shape and a missing store is a type hole, not a runtime surprise.
 */
export async function renderWithStores<S extends GlobalStores = GlobalStores>(
    ui: ReactNode,
    options: RenderWithStoresOptions<S> = {},
): Promise<StoresHandle> {
    // The one sanctioned widening: a partial container stands in for the full one. Marked
    // ready so RootStoreProvider renders synchronously (no init() round-trip).
    const root = new RootStore((options.stores ?? {}) as S, { isReady: true });
    const wrap = (node: ReactNode) => (
        <RootStoreProvider rootStore={root}>{node}</RootStoreProvider>
    );
    const mount = await mountTree(wrap(ui));
    return {
        ...mount,
        // Re-wrap so a re-render keeps the stores provider (the bare mount.rerender would drop it).
        rerender: (next) => mount.rerender(wrap(next)),
        text: () => mount.container.textContent?.trim() ?? null,
    };
}
