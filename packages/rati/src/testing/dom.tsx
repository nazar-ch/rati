import { act } from 'react';
import type { ReactNode } from 'react';
import { createRoot, hydrateRoot, type Root } from 'react-dom/client';
import { withActEnvironment, withActEnvironmentSync } from './actEnvironment';

/*
    The shared mount plumbing behind renderIsland / createTestRouter / renderWithStores / the
    SSR round-trip kit: a `react-dom/client` mount (or `hydrateRoot`) into document.body, an
    async-act render (so a self-settling load reaches content), a per-mount dispose hook (the
    router harness detaches its history through it), and one `cleanup()` that tears them all
    down. It does not depend on `@testing-library/react`. The act flag is scoped around each
    of its own `act` calls (see ./actEnvironment) — the consuming suite's policy is untouched.
*/

interface Mount {
    readonly root: Root;
    readonly container: HTMLElement;
    readonly onDispose: (() => void) | undefined;
}

const mounts = new Set<Mount>();

/**
 * Render `node` into `root` under one async `act`, which drives React's Suspense retries so
 * a self-resolving load reaches content. A load still pending (a `deferred`, an un-driven
 * `controllableSource`) simply stays on its loading slot. One caveat rides along: React skips
 * StrictMode's mount/unmount/remount double-invoke under an async act, so a test pinning that
 * discard-the-first-run behavior must render synchronously instead.
 */
async function settleRender(root: Root, node: ReactNode): Promise<void> {
    await withActEnvironment(() =>
        act(async () => {
            root.render(node);
        }),
    );
}

/**
 * What a container *says* — its trimmed `textContent` with React's hidden subtrees left out.
 *
 * A Suspense boundary that re-suspends after having shown content keeps the old children in
 * the DOM at `display: none` beside its fallback, so a plain `textContent` reads the page
 * twice: once dead, once live. Every `text()` in this entry reads through here, which is the
 * container-wide twin of the per-slot rule `renderIsland` already follows.
 */
export function visibleText(container: HTMLElement): string | null {
    const clone = container.cloneNode(true) as HTMLElement;
    for (const node of clone.querySelectorAll<HTMLElement>('*')) {
        if (node.style.display === 'none') node.remove();
    }
    return clone.textContent?.trim() ?? null;
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
    const container = document.createElement('div');
    container.innerHTML = html;
    document.body.appendChild(container);
    let root: Root | undefined;
    try {
        await withActEnvironment(() =>
            act(async () => {
                root = hydrateRoot(
                    container,
                    node,
                    options.onRecoverableError
                        ? { onRecoverableError: options.onRecoverableError }
                        : {},
                );
            }),
        );
    } catch (error) {
        // A hydration that throws out of the act must not leak its container across tests:
        // track the root for cleanup() if it got created, else remove the container outright.
        // (mountTree is immune — its mount is on the ledger before the first render.)
        if (root) mounts.add({ root, container, onDispose: options.onDispose });
        else container.remove();
        throw error;
    }
    const mount: Mount = { root: root as Root, container, onDispose: options.onDispose };
    mounts.add(mount);
    return {
        container,
        // A hydrated root's `.render()` is a normal client update — the rerender path.
        rerender: (next) => settleRender(mount.root, next),
        unmount: () => teardown(mount),
    };
}

function teardown(mount: Mount): void {
    withActEnvironmentSync(() => act(() => mount.root.unmount()));
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
