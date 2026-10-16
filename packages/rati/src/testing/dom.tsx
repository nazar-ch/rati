import { act } from 'react';
import type { ReactNode } from 'react';
import { createRoot, hydrateRoot, type Root } from 'react-dom/client';

import { withActEnvironment, withActEnvironmentSync } from './actEnvironment.js';

/*
    The shared mount plumbing behind the harnesses: a `react-dom/client` mount or `hydrateRoot`
    into document.body under an async act, a per-mount dispose hook, and one `cleanup()`. No
    `@testing-library/react`; the act flag is scoped around its own calls (./actEnvironment).
*/

interface Mount {
    readonly root: Root;
    readonly container: HTMLElement;
    readonly onDispose: (() => void) | undefined;
}

const mounts = new Set<Mount>();

/**
 * Renders `node` into `root` under one async `act`, which drives Suspense retries so a
 * self-resolving load reaches content. React skips StrictMode's double-invoke under an async
 * act, so a test pinning it renders synchronously.
 */
async function settleRender(root: Root, node: ReactNode): Promise<void> {
    await withActEnvironment(() =>
        act(async () => {
            root.render(node);
        }),
    );
}

/**
 * What a container SAYS: its trimmed `textContent` without React's hidden subtrees. A
 * re-suspended boundary keeps its old children at `display: none` beside the fallback, so a
 * plain `textContent` reads the page twice.
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
 * Hydrates `html`, a prior server render, with `node` under one async `act`; the container is
 * pre-filled, so React attaches to the markup. `onRecoverableError` observes the mismatches
 * React recovers from; `onDispose` runs after teardown. Tracked for {@link cleanup}.
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
 * Unmounts every tree the harness mounted, removing its containers and detaching a router's
 * history — the RTL `cleanup` analogue. Wire it as `afterEach(cleanup)`.
 */
export function cleanup(): void {
    // `teardown` deletes only the current entry, which Set iteration tolerates.
    for (const mount of mounts) teardown(mount);
}
