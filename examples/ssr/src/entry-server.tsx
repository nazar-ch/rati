import { renderToString } from 'react-dom/server';
import { createMemoryHistory, prepareRoute } from 'rati';
import { createApp } from './createApp';

export interface RenderResult {
    html: string;
    /** Snapshot to embed in the HTML so the client can hydrate without re-fetching. */
    state: unknown;
    /** 200 for matched routes, 404 when no route (including the catch-all) matches. */
    status: 200 | 404;
}

export async function render(url: string): Promise<RenderResult> {
    const history = createMemoryHistory({ url });
    const { router, App } = createApp({ history });

    const prepared = await prepareRoute(router);
    if (!prepared) {
        // No route matched — not even a catch-all. Caller can render a custom
        // 404 page; here we just return an empty body and let the template fill
        // in the surrounding chrome.
        router.dispose();
        return { html: '', state: null, status: 404 };
    }

    const html = renderToString(<App />);
    router.dispose();

    return {
        html,
        state: prepared.hydratedState,
        status: prepared.hydratedState.activeRouteName === 'notFound' ? 404 : 200,
    };
}
