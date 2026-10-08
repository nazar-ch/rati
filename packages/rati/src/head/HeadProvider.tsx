import { useEffect, useState, type ReactNode } from 'react';

import { HeadContext } from './context.js';
import { applyToDocument, RATI_HEAD_ATTRIBUTE, RATI_HEAD_SERVER } from './domSync.js';
import { createHeadStore, type HeadStore } from './store.js';

/**
 * Provides the head store and keeps `document.title` and the rati-managed `<meta>` tags on
 * its winners on the client; the server reads them with `headTags` (rati/ssr). Pass a
 * `store` when something outside the tree reads it — a server entry, one per request.
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
        // No server-written tag means rati didn't render this page's head, so the tree owns it
        // from the first apply; otherwise the store stays `hydrating` until a declaration
        // leaves (store.ts).
        const serverHead = `[${RATI_HEAD_ATTRIBUTE}="${RATI_HEAD_SERVER}"]`;
        if (!document.head.querySelector(serverHead)) activeStore.settle();

        const apply = () => applyToDocument(activeStore);
        apply();
        return activeStore.subscribe(apply);
    }, [activeStore]);

    return <HeadContext value={activeStore}>{children}</HeadContext>;
}
