import type { HeadStore, MetaTag } from './store.js';

/**
 * Marks the tags rati manages — both the ones `headTags` (rati/ssr) emits and the ones
 * the client sync creates — so the reconciler below can adopt, update, and remove
 * exactly its own tags and never touch app-owned or React-hoisted ones.
 */
export const RATI_HEAD_ATTRIBUTE = 'data-rati-head';

/**
 * The marker's value says who wrote the tag. Only `server` is evidence of a rati prerender,
 * which HeadProvider reads on mount to pick the store's phase: a client-only app's root
 * unmount leaves its own marked metas behind (docs/current/internals.md).
 */
export const RATI_HEAD_SERVER = 'server';
export const RATI_HEAD_CLIENT = 'client';

/**
 * Applies the store's winners to `document.title` and the rati-managed metas, from
 * HeadProvider's effect on every store notification. While the store is `hydrating` the
 * document is the server's: declared winners land, and nothing undeclared is touched.
 */
export function applyToDocument(store: HeadStore): void {
    const live = store.phase === 'live';
    const { title, metas } = store.snapshot(live ? 'client' : 'hydrating');
    if (title !== null) document.title = title;
    reconcileMetas(metas, live);
}

function matches(element: Element, meta: MetaTag): boolean {
    return meta.property !== undefined
        ? element.getAttribute('property') === meta.property
        : element.getAttribute('name') === meta.name;
}

function reconcileMetas(metas: MetaTag[], removeOrphans: boolean): void {
    const managed = [...document.head.querySelectorAll(`meta[${RATI_HEAD_ATTRIBUTE}]`)];
    const kept = new Set<Element>();

    for (const meta of metas) {
        const existing = managed.find((element) => matches(element, meta));
        if (existing) {
            kept.add(existing);
            if (existing.getAttribute('content') !== meta.content) {
                existing.setAttribute('content', meta.content);
            }
        } else {
            const element = document.createElement('meta');
            if (meta.property !== undefined) element.setAttribute('property', meta.property);
            else if (meta.name !== undefined) element.setAttribute('name', meta.name);
            element.setAttribute('content', meta.content);
            element.setAttribute(RATI_HEAD_ATTRIBUTE, RATI_HEAD_CLIENT);
            document.head.appendChild(element);
        }
    }

    if (!removeOrphans) return;
    for (const element of managed) {
        if (!kept.has(element)) element.remove();
    }
}
