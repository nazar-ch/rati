/*
    HTML assembly: a `rendered` result and a shell in, a page out — the template and whole-document
    patterns docs/current/public/ssr.md describes. `rati/vite` dev and `rati/server` share it, so
    dev and production pages match; a value with nowhere to go throws with the fix.
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
 * Who is assembling. A refusal below has to name the fix, and the fix is a different
 * call in each of them — so each says who it is rather than the shared code guessing.
 */
export interface Assembler {
    /** The entry the user is looking at: `rati:ssr`, `rati/server`. */
    name: string;
    /** What to call the shell — a path where it is a file, `the template` where it is a value. */
    template: string;
    /** The call that names the placeholders: `ratiSsr({ placeholders })`. */
    option: string;
}

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
    by: Assembler,
): string {
    let html = fill(template, placeholders.html, parts.html, 'the rendered app', by);
    html = fill(html, placeholders.head, parts.headTags, 'the head tags', by);
    return fill(html, placeholders.state, parts.stateScript, 'the hydration payload', by);
}

export function spliceDocument(document: string, parts: RenderedParts, by: Assembler): string {
    const withHead = spliceBefore(
        document,
        '</head>',
        'first',
        parts.headTags,
        'the head tags',
        by,
    );
    return spliceBefore(
        withHead,
        '</body>',
        'last',
        parts.stateScript,
        'the hydration payload',
        by,
    );
}

function fill(
    html: string,
    placeholder: string,
    value: string,
    label: string,
    by: Assembler,
): string {
    if (!html.includes(placeholder)) {
        if (!value) return html;
        throw new Error(
            `${by.name} — ${by.template} has no ${placeholder}, so ${label} would be dropped. ` +
                `Add the placeholder, or name your own with ${by.option}.`,
        );
    }
    // A replacer function: String.replace reads `$&` and `$1` in a replacement STRING as
    // capture references, and rendered markup can contain them (a price, a query string).
    return html.replace(placeholder, () => value);
}

function spliceBefore(
    html: string,
    anchor: string,
    which: 'first' | 'last',
    value: string,
    label: string,
    by: Assembler,
): string {
    if (!value) return html;
    // The document's own `</head>` is the first one — React escapes page text, so
    // nothing before it can be a literal. Its `</body>` is the last one: a page that
    // renders HTML samples can carry a literal earlier, in the body.
    const at = which === 'first' ? html.indexOf(anchor) : html.lastIndexOf(anchor);
    if (at === -1) {
        throw new Error(
            `${by.name} — the rendered document has no ${anchor}, so ${label} would be dropped.`,
        );
    }
    return html.slice(0, at) + value + html.slice(at);
}
