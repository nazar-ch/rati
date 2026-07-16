import { useEffect, useState, type ReactNode } from 'react';
import { HeadContext } from './context';
import { applyToDocument, RATI_HEAD_ATTRIBUTE } from './domSync';
import { createHeadStore, type HeadStore } from './store';

/**
 * Provides the head store and keeps the live document in sync on the client:
 * `document.title` and the rati-managed `<meta>` tags follow the store's winners —
 * on hydration and on every client-side navigation. The server runs no effects; there
 * the winners are read after prerender with `headTags` (rati/ssr).
 *
 * Pass a `store` when something outside the tree needs to read it — a server entry
 * does, one store per request. A client-only app can omit it and the provider owns one
 * internally.
 */
export function HeadProvider({
    store,
    children,
}: {
    store?: HeadStore;
    children: ReactNode;
}): ReactNode {
    const [ownStore] = useState(() => store ?? createHeadStore());
    const activeStore = store ?? ownStore;

    useEffect(() => {
        // No rati-marked tag in the document → rati didn't render this page's head, so
        // there is nothing of the server's to preserve and the tree can own it from the
        // first apply (a client-only app gets `defaultTitle` immediately). Otherwise the
        // store stays `hydrating` until something removes a declaration — store.ts §phase.
        if (!document.head.querySelector(`[${RATI_HEAD_ATTRIBUTE}]`)) activeStore.settle();

        const apply = () => applyToDocument(activeStore);
        apply();
        return activeStore.subscribe(apply);
    }, [activeStore]);

    return <HeadContext value={activeStore}>{children}</HeadContext>;
}
