import { RATI_HEAD_ATTRIBUTE, RATI_HEAD_SERVER } from '../head/domSync';
import type { HeadStore } from '../head/store';

function escapeText(value: string): string {
    return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function escapeAttribute(value: string): string {
    return escapeText(value).replaceAll('"', '&quot;');
}

/**
 * The head store's winners as HTML for `<head>` — the server-side read-back. Call
 * *after* the prerender resolved: a `<Title>`/`<Meta>` inside a route registers during
 * the prerender's Suspense resolution, so reading earlier misses it. Inject the result
 * outside the React tree (spliced before `</head>`, or via an HTML-template slot) so
 * React doesn't try to reconcile it during hydration.
 *
 * Every tag is marked `data-rati-head="server"`. On the metas the marker is bookkeeping
 * — HeadProvider's client sync adopts and updates them on navigation instead of
 * duplicating. Its `server` value, on every tag, is evidence: it is how the client tells
 * that this document's head came from rati's server and must not be overwritten before
 * the page that declares it has hydrated (head/store.ts §phase). That is also why the
 * `<title>` carries it, though `document.title` writes to the same node either way.
 */
export function headTags(store: HeadStore): string {
    const { title, metas } = store.snapshot('server');
    const marker = `${RATI_HEAD_ATTRIBUTE}="${RATI_HEAD_SERVER}"`;
    const tags: string[] = [];
    if (title !== null) {
        tags.push(`<title ${marker}>${escapeText(title)}</title>`);
    }
    for (const meta of metas) {
        const key =
            meta.property !== undefined
                ? `property="${escapeAttribute(meta.property)}"`
                : `name="${escapeAttribute(meta.name ?? '')}"`;
        tags.push(`<meta ${key} content="${escapeAttribute(meta.content)}" ${marker}>`);
    }
    return tags.join('');
}
