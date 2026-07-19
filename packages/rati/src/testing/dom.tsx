import { act } from 'react';
import type { ReactNode } from 'react';
import { createRoot, hydrateRoot, type Root } from 'react-dom/client';

/*
    The shared mount plumbing behind renderIsland / createTestRouter / renderWithStores / the
    SSR round-trip kit: a `react-dom/client` mount (or `hydrateRoot`) into document.body, an
    async-act render (so a self-settling load reaches content), a per-mount dispose hook (the
    router harness detaches its history through it), and one `cleanup()` that tears them all
    down. It does not depend on `@testing-library/react`.
*/

interface Mount {
    readonly root: Root;
    readonly container: HTMLElement;
    readonly onDispose: (() => void) | undefined;
}

const mounts = new Set<Mount>();

function ensureActEnvironment(): void {
    // A configured test runner sets this (`@testing-library/react` does on import); set it
    // defensively so a standalone consumer's `act` calls don't warn. Respects an explicit false.
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT ??= true;
}

/**
 * Render `node` into `root` under one async `act`, which drives React's Suspense retries so
 * a self-resolving load reaches content. A load still pending (a `deferred`, an un-driven
 * `controllableSource`) simply stays on its loading slot. One caveat rides along: React skips
 * StrictMode's mount/unmount/remount double-invoke under an async act, so a test pinning that
 * discard-the-first-run behavior must render synchronously instead.
 */
async function settleRender(root: Root, node: ReactNode): Promise<void> {
    await act(async () => {
        root.render(node);
    });
}

/** A mounted React tree: its container, a re-render, and teardown. */
export interface MountedTree {
    readonly container: HTMLElement;
    rerender(node: ReactNode): Promise<void>;
    unmount(): void;
}

/**
 * Mount `node` into a fresh container appended to `document.body`. `onDispose` runs at
 * unmount, after React tears the tree down (the router harness detaches its history here).
 * Tracked for {@link cleanup}.
 */
export async function mountTree(node: ReactNode, onDispose?: () => void): Promise<MountedTree> {
    ensureActEnvironment();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const mount: Mount = { root, container, onDispose };
    mounts.add(mount);
    await settleRender(root, node);
    return {
        container,
        rerender: (next) => settleRender(root, next),
        unmount: () => teardown(mount),
    };
}

/**
 * Hydrate `html` (a prior server render) with `node` under one async `act` — the client
 * half of an SSR round-trip. The container is pre-filled with `html` before `hydrateRoot`,
 * so React attaches to the existing markup instead of re-creating it. `onRecoverableError`
 * observes the mismatches React recovers from (the round-trip kit turns them into failures);
 * `onDispose` runs at unmount, after teardown (the route round-trip disposes its client
 * router here). Tracked for {@link cleanup}, exactly like {@link mountTree}.
 */
export async function hydrateTree(
    html: string,
    node: ReactNode,
    options: { onRecoverableError?: (error: unknown) => void; onDispose?: () => void } = {},
): Promise<MountedTree> {
    ensureActEnvironment();
    const container = document.createElement('div');
    container.innerHTML = html;
    document.body.appendChild(container);
    let root!: Root;
    await act(async () => {
        root = hydrateRoot(
            container,
            node,
            options.onRecoverableError ? { onRecoverableError: options.onRecoverableError } : {},
        );
    });
    const mount: Mount = { root, container, onDispose: options.onDispose };
    mounts.add(mount);
    return {
        container,
        // A hydrated root's `.render()` is a normal client update — the rerender path.
        rerender: (next) => settleRender(root, next),
        unmount: () => teardown(mount),
    };
}

function teardown(mount: Mount): void {
    act(() => mount.root.unmount());
    mount.onDispose?.();
    mount.container.remove();
    mounts.delete(mount);
}

/**
 * Unmount every tree the testing harness mounted — islands (`renderIsland`), routers
 * (`createTestRouter`), stores renders (`renderWithStores`) — and remove its container. The
 * RTL `cleanup` analogue for this entry, and the seam where a router's history is detached
 * (the RF-01 leak lesson). Wire it up as `afterEach(cleanup)`.
 */
export function cleanup(): void {
    // `teardown` deletes only the current entry, which Set iteration tolerates.
    for (const mount of mounts) teardown(mount);
}
