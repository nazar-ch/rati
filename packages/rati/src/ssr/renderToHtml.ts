import type { ReactNode } from 'react';
import { prerender } from 'react-dom/static';

/*
    Past `progressiveChunkSize` flushed bytes React stops writing a completed Suspense
    boundary in place and *outlines* it: the content goes into a detached `<div hidden>`
    at the end of the document, and an inline script swaps it over the loading slot. The
    default (12.8KB) is tuned for a streaming server, where outlining is exactly what
    lets a small shell flush before the slow boundaries resolve.

    This renderer never flushes early — it awaits every boundary and returns one
    finished string — so outlining collects none of that benefit and keeps all of its
    costs: a no-JS reader (a crawler) gets the loading slot, and the reveal is JS- and
    rAF-gated, so a backgrounded tab doesn't run it either. A budget nothing can reach
    keeps every completed boundary inline. Streaming is a different contract rather than
    a knob here — docs/research/ssr-streaming.md.

    Two things React still decides for itself: a boundary carrying suspensey content
    (hoisted stylesheets, suspensey images) outlines regardless of the budget, and a
    boundary that errored keeps its loading slot for the client to retry.
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
 * the caller's 500 path. Output is fully inline: every resolved boundary sits where it
 * was declared, with no hidden divs and no swap scripts (see {@link NO_OUTLINING}).
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
