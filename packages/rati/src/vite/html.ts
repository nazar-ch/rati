/*
    HTML assembly for the dev middleware — the two patterns docs/public/ssr.md
    describes, and nothing else.

    Template: an index.html carrying `<!--app-head-->` / `<!--app-html-->` /
    `<!--app-state-->`, React rendering into #root.

    Whole document: React rendered `<html>` itself, so there is no template — the head
    tags and the payload script splice into the rendered document string, outside the
    React tree, so React neither reconciles nor duplicates them on hydration.

    Both refuse to drop content. A value with nowhere to go means a page that looks
    plausible and is broken — a template missing `<!--app-state-->` hydrates from
    scratch, and SSR quietly stops paying for itself — so assembly throws with the fix
    instead of serving it.
*/

/** The parts of a `rendered` result that assembly places. */
export interface RenderedParts {
    html: string;
    headTags: string;
    stateScript: string;
}

export interface Placeholders {
    head: string;
    html: string;
    state: string;
}

export const DEFAULT_PLACEHOLDERS: Placeholders = {
    head: '<!--app-head-->',
    html: '<!--app-html-->',
    state: '<!--app-state-->',
};

/**
 * A rendered whole document rather than a fragment — the app rendered `<html>` itself,
 * so there is no template to fill.
 */
export function isWholeDocument(html: string): boolean {
    const start = html.trimStart().slice(0, 9).toLowerCase();
    return start.startsWith('<!doctype') || start.startsWith('<html');
}

export function fillTemplate(
    template: string,
    parts: RenderedParts,
    placeholders: Placeholders,
    templatePath: string,
): string {
    let html = fill(template, placeholders.html, parts.html, 'the rendered app', templatePath);
    html = fill(html, placeholders.head, parts.headTags, 'the head tags', templatePath);
    return fill(html, placeholders.state, parts.stateScript, 'the hydration payload', templatePath);
}

export function spliceDocument(document: string, parts: RenderedParts): string {
    const withHead = spliceBefore(document, '</head>', 'first', parts.headTags, 'the head tags');
    return spliceBefore(withHead, '</body>', 'last', parts.stateScript, 'the hydration payload');
}

function fill(
    html: string,
    placeholder: string,
    value: string,
    label: string,
    templatePath: string,
): string {
    if (!html.includes(placeholder)) {
        if (!value) return html;
        throw new Error(
            `rati:ssr — ${templatePath} has no ${placeholder}, so ${label} would be dropped. ` +
                `Add the placeholder, or name your own with ratiSsr({ placeholders }).`,
        );
    }
    // A replacer function, not the value directly: String.replace reads `$&`, `$1` and
    // friends in a *replacement string* as capture references, and rendered markup can
    // contain them (a price, a query string).
    return html.replace(placeholder, () => value);
}

function spliceBefore(
    html: string,
    anchor: string,
    which: 'first' | 'last',
    value: string,
    label: string,
): string {
    if (!value) return html;
    // The document's own `</head>` is the first one — React escapes page text, so
    // nothing before it can be a literal. Its `</body>` is the last one: a page that
    // renders HTML samples can carry a literal earlier, in the body.
    const at = which === 'first' ? html.indexOf(anchor) : html.lastIndexOf(anchor);
    if (at === -1) {
        throw new Error(
            `rati:ssr — the rendered document has no ${anchor}, so ${label} would be dropped.`,
        );
    }
    return html.slice(0, at) + value + html.slice(at);
}
