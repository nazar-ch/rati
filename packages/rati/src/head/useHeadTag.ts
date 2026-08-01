import { useEffect, useId } from 'react';
import { useHeadStore } from './context';
import type { HeadTag } from './store';

/**
 * The shared half of `useTitle` / `<Title>` / `<Meta>`: declare one head tag, keyed by
 * this hook instance's `useId`. Registration happens in the render phase so a server
 * prerender (which runs no effects) sees it; on the client an effect commits the value
 * (only committed entries count as winners there — see store.ts) and removes it on
 * unmount. `null` declares nothing and withdraws an uncommitted registration.
 */
export function useHeadTag(tag: HeadTag | null, caller: string): void {
    const store = useHeadStore(caller);
    const id = useId();

    if (tag) store.set(id, tag);
    else store.clear(id);

    // The tag decomposed to primitives, so an identical object doesn't re-run the effect.
    const kind = tag?.kind;
    const text = tag ? (tag.kind === 'title' ? tag.text : tag.content) : undefined;
    const name = tag?.kind === 'meta' ? tag.name : undefined;
    const property = tag?.kind === 'meta' ? tag.property : undefined;

    useEffect(() => {
        if (kind === 'title' && text !== undefined) {
            store.commit(id, { kind: 'title', text });
        } else if (kind === 'meta' && text !== undefined) {
            store.commit(id, {
                kind: 'meta',
                content: text,
                ...(name !== undefined ? { name } : {}),
                ...(property !== undefined ? { property } : {}),
            });
        } else {
            store.remove(id);
        }
    }, [store, id, kind, text, name, property]);

    useEffect(() => () => store.remove(id), [store, id]);
}
