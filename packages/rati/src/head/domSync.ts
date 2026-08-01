import type { HeadStore, MetaTag } from './store';

/**
 * Marks the tags rati manages — both the ones `headTags` (rati/ssr) emits and the ones
 * the client sync creates — so the reconciler below can adopt, update, and remove
 * exactly its own tags and never touch app-owned or React-hoisted ones.
 */
export const RATI_HEAD_ATTRIBUTE = 'data-rati-head';

/**
 * …and the value says who wrote it. Both are rati's to reconcile, but only `server` is
 * evidence that this document's head came from a rati prerender — which is what
 * HeadProvider reads on mount to decide the store's phase (store.ts). The two are
 * distinct because a client-only app leaves its own marked metas in `<head>` when a
 * root unmounts (React tears the provider's subscription down before the declarations'
 * removals, so the final reconcile never runs); a fresh store must not read those as a
 * server head and spend its life protecting one that was never there.
 */
export const RATI_HEAD_SERVER = 'server';
export const RATI_HEAD_CLIENT = 'client';

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
            element.setAttribute(RATI_HEAD_ATTRIBUTE, RATI_HEAD_CLIENT);
            document.head.appendChild(element);
        }
    }

    if (!removeOrphans) return;
    for (const element of managed) {
        if (!kept.has(element)) element.remove();
    }
}
