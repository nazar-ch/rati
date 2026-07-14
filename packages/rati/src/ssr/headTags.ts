import { RATI_HEAD_ATTRIBUTE } from '../head/domSync';
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
 * Meta tags carry the rati marker attribute, so HeadProvider's client sync adopts and
 * updates them on navigation instead of duplicating. The `<title>` needs no marker —
 * `document.title` writes to the same node.
 */
export function headTags(store: HeadStore): string {
    const { title, metas } = store.snapshot('server');
    const tags: string[] = [];
    if (title !== null) tags.push(`<title>${escapeText(title)}</title>`);
    for (const meta of metas) {
        const key =
            meta.property !== undefined
                ? `property="${escapeAttribute(meta.property)}"`
                : `name="${escapeAttribute(meta.name ?? '')}"`;
        tags.push(
            `<meta ${key} content="${escapeAttribute(meta.content)}" ${RATI_HEAD_ATTRIBUTE}>`,
        );
    }
    return tags.join('');
}
