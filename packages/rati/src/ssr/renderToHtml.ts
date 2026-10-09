import type { ReactNode } from 'react';
import { prerender } from 'react-dom/static';

/*
    long:2
    Past `progressiveChunkSize` flushed bytes React outlines a completed Suspense boundary into a
    hidden `<div>` and a swap script, a streaming server's tool. This renderer returns one
    finished string, where outlining hides content from a no-JS reader, so a budget nothing
    reaches keeps every boundary inline. React still outlines a boundary with suspensey content,
    and an errored boundary keeps its loading slot for the client to retry.
*/
const NO_OUTLINING = Number.MAX_SAFE_INTEGER;

export interface RenderToHtmlOptions {
    /**
     * Client entry module(s) — React emits them as hydration-tracked
     * `<script type="module">` + modulepreload, so they don't need to appear in the
     * HTML shell.
     */
    bootstrapModules?: string[];
    /**
     * Forwarded to `prerender`, firing inside Suspense boundaries too, where React degrades
     * to the loading slot; island load failures also land in the collector's `errors`.
     * Defaults to React's own logging.
     */
    onError?: (error: unknown) => void;
}

/**
 * Drains `react-dom/static` `prerender`, which awaits Suspense, into one HTML string with
 * every resolved boundary inline ({@link NO_OUTLINING}). Rejects only for an error outside
 * every Suspense boundary — the caller's 500 path.
 */
export async function renderToHtml(
    node: ReactNode,
    options: RenderToHtmlOptions = {},
): Promise<string> {
    const { prelude } = await prerender(node, {
        progressiveChunkSize: NO_OUTLINING,
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
