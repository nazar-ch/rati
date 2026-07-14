import type { ReactNode } from 'react';
import { prerender } from 'react-dom/static';

export interface RenderToHtmlOptions {
    /**
     * Client entry module(s) — React emits them as hydration-tracked
     * `<script type="module">` + modulepreload, so they don't need to appear in the
     * HTML shell.
     */
    bootstrapModules?: string[];
    /**
     * Forwarded to `prerender`. Fires for errors inside Suspense boundaries too —
     * where React degrades to the loading slot and the promise still resolves (island
     * load failures land in the hydration collector's `errors`; this callback is the
     * raw React-level view). Defaults to React's own logging.
     */
    onError?: (error: unknown) => void;
}

/**
 * Drain `react-dom/static` `prerender` into a single HTML string. `prerender` — not
 * `renderToString` — because it awaits Suspense: a route island's promise loads
 * resolve during the render, so the HTML carries the content, not the loading slot.
 * Rejects only for errors outside every Suspense boundary (an app-shell render bug) —
 * the caller's 500 path.
 */
export async function renderToHtml(
    node: ReactNode,
    options: RenderToHtmlOptions = {},
): Promise<string> {
    const { prelude } = await prerender(node, {
        ...(options.bootstrapModules ? { bootstrapModules: options.bootstrapModules } : {}),
        ...(options.onError ? { onError: options.onError } : {}),
    });
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
