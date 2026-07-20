import type { ComponentType, ReactNode } from 'react';
import { RootStore, RootStoreProvider, type GlobalStores } from '../stores/RootStore';
import { mountTree, visibleText, type MountedTree } from './dom';

/*
    The stores-injection seam — the shape ten Jnana component tests build by hand and inject
    through `GenericStoresContext.Provider` with an `as unknown as GlobalStores` cast. The
    container-level cast dies here: the test hands a typed partial ("I provide only the two
    stores this component reads — and only the slice of each it touches"), and the one
    sanctioned widening lives inside the helper.

    Two layers: `storesWrapper` builds just the provider component — for suites that keep
    their own renderer (RTL's `wrapper` option, `vitest-browser-react`, a bespoke harness) —
    and `renderWithStores` is that wrapper plus the entry's own mount, for suites without one.

    Reconcile note: this item's cut assumed the stores-container effort (StoresProvider /
    createStoresHook, `GenericStoresContext` internalized) had landed — it had not. What
    shipped is `RootStore` + `RootStoreProvider` + a still-public `GenericStoresContext` +
    `createUseStoresHook`. So the seam builds on that (a RootStore marked ready behind
    RootStoreProvider) rather than re-exposing anything, and stays a designed surface. See the
    effort README's DX-03 delta note.
*/

/**
 * A partial stores container where each provided store may itself be a partial — the slice
 * a component actually reads (`{ authStore: { isExpired: true } }`), typed against the real
 * store so a misspelled or mistyped field is still an error. One level deep: a nested object
 * on a store (say, a `user` model) is taken whole.
 */
export type PartialStores<S extends GlobalStores> = { [K in keyof S]?: Partial<S[K]> };

/**
 * Build a provider component carrying a stores container made from `stores` — the
 * mount-free seam, for tests that keep their own renderer: pass it as RTL's `wrapper`
 * option (or wrap the tree handed to any other harness). Parameterize with the app's stores
 * type — `storesWrapper<AppStores>({ foo, bar: { count: 3 } })` — so the partial is checked
 * against the real shape.
 */
export function storesWrapper<S extends GlobalStores = GlobalStores>(
    stores: PartialStores<S> = {},
): ComponentType<{ children?: ReactNode }> {
    // The one sanctioned widening: a partial container (of partial stores) stands in for
    // the full one. Marked ready so RootStoreProvider renders synchronously (no init()
    // round-trip).
    const root = new RootStore(stores as S, { isReady: true });
    return function StoresWrapper({ children }: { children?: ReactNode }) {
        return <RootStoreProvider rootStore={root}>{children}</RootStoreProvider>;
    };
}

/** Options for {@link renderWithStores}. */
export interface RenderWithStoresOptions<S extends GlobalStores> {
    /** The stores this component reads — a typed partial of the app's stores, each store
     *  itself partial-able (see {@link PartialStores}). */
    stores?: PartialStores<S>;
}

/** The handle {@link renderWithStores} returns. */
export interface StoresHandle extends MountedTree {
    /** What the container says — see {@link visibleText}. */
    text(): string | null;
}

/**
 * Render `ui` under a stores container built from `stores` — {@link storesWrapper} plus the
 * entry's own mount. Parameterize with the app's stores type —
 * `renderWithStores<AppStores>(ui, { stores: { a, b } })` — so the partial is checked
 * against the real shape and a missing store is a type hole, not a runtime surprise.
 */
export async function renderWithStores<S extends GlobalStores = GlobalStores>(
    ui: ReactNode,
    options: RenderWithStoresOptions<S> = {},
): Promise<StoresHandle> {
    const Wrapper = storesWrapper<S>(options.stores);
    const mount = await mountTree(<Wrapper>{ui}</Wrapper>);
    return {
        ...mount,
        // Re-wrap so a re-render keeps the stores provider (the bare mount.rerender would drop it).
        rerender: (next) => mount.rerender(<Wrapper>{next}</Wrapper>),
        text: () => visibleText(mount.container),
    };
}
