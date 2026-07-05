import { prerender } from 'react-dom/static';
import type { ReactElement } from 'react';
import { createMemoryHistory } from 'rati';
import { createHydrationCollector, prepareRoute } from 'rati/ssr';
import { type AppHydrationState, createApp } from './createApp';

export interface RenderResult {
    html: string;
    /** Snapshot to embed in the HTML so the client can hydrate without re-fetching. */
    state: AppHydrationState | null;
    /** 200 for matched routes, 404 when no route (including the catch-all) matches. */
    status: 200 | 404;
}

// react-dom/static `prerender` awaits all Suspense before producing HTML, so an
// island route's promise-backed scope resolves server-side (plain `renderToString`
// does not — it would emit the loading slot). Drain its stream to a single string.
async function prerenderToString(element: ReactElement): Promise<string> {
    const { prelude } = await prerender(element);
    const reader = prelude.getReader();
    const decoder = new TextDecoder();
    let html = '';
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        html += decoder.decode(value, { stream: true });
    }
    return html;
}

export async function render(url: string): Promise<RenderResult> {
    const history = createMemoryHistory({ url });
    const collector = createHydrationCollector();
    const { router, App } = createApp({ history, collectIslandData: collector.collect });

    const prepared = await prepareRoute(router);
    if (!prepared) {
        // No route matched — not even a catch-all. Caller can render a custom
        // 404 page; here we just return an empty body and let the template fill
        // in the surrounding chrome.
        router.dispose();
        return { html: '', state: null, status: 404 };
    }

    // Awaits the route's scope, so its resolved data lands in the HTML; the mandala
    // engine fills `collector.data` with each resolved promise value for the client.
    const html = await prerenderToString(<App />);
    router.dispose();

    return {
        html,
        state: { router: prepared.hydratedState, islands: collector.data },
        status: prepared.hydratedState.activeRouteName === 'notFound' ? 404 : 200,
    };
}
