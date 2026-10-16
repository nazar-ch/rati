import { RATI_HEAD_ATTRIBUTE, RATI_HEAD_SERVER } from '../head/domSync.js';
import type { HeadStore } from '../head/store.js';

function escapeText(value: string): string {
    return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function escapeAttribute(value: string): string {
    return escapeText(value).replaceAll('"', '&quot;');
}

/**
 * The head store's winners as HTML for `<head>`. Call AFTER the prerender resolved, and
 * inject the result outside the React tree. Every tag is marked `data-rati-head="server"`:
 * the client sync adopts the metas, and the value says the head came from rati's server.
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
