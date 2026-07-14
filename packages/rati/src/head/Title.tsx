import { useTitle } from './useTitle';

/**
 * Declares the document title from anywhere in the tree (`<Title>{page.name}</Title>`).
 * Renders nothing — the deepest live declaration wins (a page beats a layout default),
 * the store's `titleTemplate` wraps it, and the winner reaches `document.title` on the
 * client and the `headTags` read-back on the server. `useTitle` is the hook form.
 */
export function Title({ children }: { children: string }): null {
    useTitle(children);
    return null;
}
