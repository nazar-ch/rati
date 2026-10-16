import { useTitle } from './useTitle.js';

/**
 * Declares the document title from anywhere in the tree (`<Title>{page.name}</Title>`).
 * Renders nothing; the deepest live declaration wins, wrapped by the store's
 * `titleTemplate`. `useTitle` is the hook form.
 */
export function Title({ children }: { children: string }): null {
    useTitle(children);
    return null;
}
