import { useHeadTag } from './useHeadTag';

// Exactly one of `name` (standard metadata) or `property` (Open Graph / RDFa) — the
// union makes passing both or neither a type error.
export type MetaProps = { content: string } & (
    | { name: string; property?: undefined }
    | { property: string; name?: undefined }
);

/**
 * Declares a `<meta>` tag that needs per-page dedupe — description, Open Graph, and
 * friends. Renders nothing; per `name`/`property` the deepest live declaration wins,
 * reaching the document via HeadProvider's client sync and the server's `headTags`
 * read-back. A meta that never varies by page belongs in the document shell (or as a
 * native React 19 tag), not here.
 */
export function Meta({ name, property, content }: MetaProps): null {
    useHeadTag(
        {
            kind: 'meta',
            content,
            ...(name !== undefined ? { name } : {}),
            ...(property !== undefined ? { property } : {}),
        },
        'Meta',
    );
    return null;
}
