import { deepEqual } from '../util/utils.js';

/*
    Document-head management: the store. Its mechanism — render-phase registration,
    effect-phase confirmation, dedupe by registration sequence, the one-way phase — is
    docs/current/internals.md.
*/

export type MetaTag = { name?: string; property?: string; content: string };

export type HeadTag = { kind: 'title'; text: string } | ({ kind: 'meta' } & MetaTag);

export interface HeadStoreOptions {
    /** Used when no title is declared. Rendered verbatim — the template doesn't wrap it. */
    defaultTitle?: string;
    /** Wraps every declared title, e.g. `(title) => `${title} · Site``. */
    titleTemplate?: (title: string) => string;
}

/**
 * The winners a reader acts on: the resolved document title (template and default
 * applied; `null` when nothing is declared and there is no default — leave the
 * document alone) and one meta per name/property.
 */
export interface HeadSnapshot {
    title: string | null;
    metas: MetaTag[];
}

/**
 * `hydrating`: the document may carry a server-rendered head that no declaration has
 * spoken for yet, so it is treated as authoritative. `live`: the tree owns the head.
 * One-way.
 */
export type HeadPhase = 'hydrating' | 'live';

type Entry = { seq: number; tag: HeadTag; confirmed: boolean };

// One winner per key; `title` is a single slot, metas dedupe per name/property.
function dedupeKey(tag: HeadTag): string {
    if (tag.kind === 'title') return 'title';
    return tag.property !== undefined ? `meta property=${tag.property}` : `meta name=${tag.name}`;
}

export class HeadStore {
    private readonly entries = new Map<string, Entry>();
    private readonly listeners = new Set<() => void>();
    private seq = 0;
    private _phase: HeadPhase = 'hydrating';

    constructor(private readonly options: HeadStoreOptions = {}) {}

    get phase(): HeadPhase {
        return this._phase;
    }

    /**
     * Hand the head to the tree, for a reader that knows there is no server head to
     * protect (HeadProvider, on a document with no rati-marked tags). Silent: the
     * provider settles before its first apply, and `remove()` — the other way in —
     * emits on its own.
     */
    settle(): void {
        this._phase = 'live';
    }

    /**
     * Render-phase registration (keyed by the declarer's `useId`). Silent — emitting
     * mid-render is illegal; the client effect confirms and notifies after commit.
     * Idempotent per id, and a no-op on confirmed entries.
     */
    set(id: string, tag: HeadTag): void {
        const prev = this.entries.get(id);
        if (prev?.confirmed) return;
        if (prev && deepEqual(prev.tag, tag)) return;
        this.entries.set(id, { seq: prev ? prev.seq : ++this.seq, tag, confirmed: false });
    }

    /**
     * Effect-phase registration: upsert the committed value (keeping the entry's seq)
     * and notify. The only way a confirmed entry's tag changes.
     */
    commit(id: string, tag: HeadTag): void {
        const prev = this.entries.get(id);
        const changed = !prev || !prev.confirmed || !deepEqual(prev.tag, tag);
        this.entries.set(id, { seq: prev ? prev.seq : ++this.seq, tag, confirmed: true });
        if (changed) this.emit();
    }

    /**
     * Render-phase removal (a declaration turned `null` before ever committing).
     * Confirmed entries survive — they leave through `remove`, after commit.
     */
    clear(id: string): void {
        const entry = this.entries.get(id);
        if (entry && !entry.confirmed) this.entries.delete(id);
    }

    /**
     * Effect-phase removal: an unmount, or a declaration that went `null` after
     * committing. Settles the phase on a real removal only — `useHeadTag(null)` calls this
     * on mount for a declaration that never registered. StrictMode's simulated remount
     * settles early, in dev.
     */
    remove(id: string): void {
        if (!this.entries.delete(id)) return;
        this._phase = 'live';
        this.emit();
    }

    subscribe(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    /**
     * The winners for one reader:
     *
     *   - `'server'` counts every registration, since prerender runs no effects.
     *   - `'client'` counts only effect-confirmed entries, and falls back to `defaultTitle`.
     *   - `'hydrating'` is `'client'` minus the default, so the server's `<title>` stands.
     */
    snapshot(mode: 'client' | 'server' | 'hydrating'): HeadSnapshot {
        const winners = new Map<string, Entry>();
        for (const entry of this.entries.values()) {
            if (mode !== 'server' && !entry.confirmed) continue;
            const key = dedupeKey(entry.tag);
            const current = winners.get(key);
            if (!current || entry.seq > current.seq) winners.set(key, entry);
        }

        const titleEntry = winners.get('title');
        winners.delete('title');

        let title: string | null = null;
        if (titleEntry && titleEntry.tag.kind === 'title') {
            title = this.options.titleTemplate?.(titleEntry.tag.text) ?? titleEntry.tag.text;
        } else if (mode !== 'hydrating' && this.options.defaultTitle !== undefined) {
            title = this.options.defaultTitle;
        }

        const metas: MetaTag[] = [];
        for (const entry of winners.values()) {
            if (entry.tag.kind === 'meta') {
                const { kind: _kind, ...meta } = entry.tag;
                metas.push(meta);
            }
        }
        return { title, metas };
    }

    private emit(): void {
        // Set iteration tolerates a listener unsubscribing mid-notify, so iterate directly.
        for (const listener of this.listeners) listener();
    }
}

export function createHeadStore(options: HeadStoreOptions = {}): HeadStore {
    return new HeadStore(options);
}
