import type { HeadStore, MetaTag } from './store';

/**
 * Marks the tags rati manages — both the ones `headTags` (rati/ssr) emits and the ones
 * the client sync creates — so the reconciler below can adopt, update, and remove
 * exactly its own tags and never touch app-owned or React-hoisted ones. On the emitted
 * `<title>` it is evidence rather than bookkeeping: it is how HeadProvider tells a
 * rati-server-rendered document from a client-only one.
 */
export const RATI_HEAD_ATTRIBUTE = 'data-rati-head';

/**
 * Apply the store's winners to the live document: `document.title` (also updating a
 * server-injected `<title>`, which is the same node) and the rati-managed meta tags.
 * Runs from HeadProvider's effect on every store notification.
 *
 * While the store is `hydrating` the document belongs to the server (store.ts §phase):
 * declared winners land as they commit, but nothing the tree hasn't spoken for is
 * touched — no `defaultTitle` over the server's title, no removing a server meta whose
 * declarer may simply not have hydrated yet.
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
            element.setAttribute(RATI_HEAD_ATTRIBUTE, '');
            document.head.appendChild(element);
        }
    }

    if (!removeOrphans) return;
    for (const element of managed) {
        if (!kept.has(element)) element.remove();
    }
}
