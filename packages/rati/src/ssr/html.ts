/*
    HTML assembly: a `rendered` result and a shell in, a page out — the two patterns
    docs/public/ssr.md describes, and nothing else.

    It sits here, next to the render loop, because both things that assemble compose it:
    `rati/vite`'s dev middleware and `rati/server`'s request handler. Neither owns it,
    and a page must not come out of dev one way and out of production another.

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
