import { useHeadTag } from './useHeadTag';

/**
 * Hook form of `<Title>`: declare the document title from page content. The deepest
 * live declaration wins; the store's `titleTemplate` wraps it. `null`/`undefined`
 * declares nothing — an outer declaration or the store's `defaultTitle` stays — so a
 * not-yet-loaded title needs no conditional hook call.
 */
export function useTitle(title: string | null | undefined): void {
    useHeadTag(title == null ? null : { kind: 'title', text: title }, 'useTitle');
}
