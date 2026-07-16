import { deepEqual } from '../util/utils';

/*
    Document-head management: the store.

    rati's head layer owns only the tags that need *dedupe by depth* plus a server
    read-back after prerender — the title and per-page meta (description, Open Graph).
    Several declarations are live at once in the normal case (a layout default plus a
    page value, or the old and new page during a client-side navigation), and React 19
    hoists metadata elements into `<head>` but does not dedupe them — so a rendered
    `<title>`/`<meta>` cannot express "deepest wins". Everything that doesn't need
    dedupe (one-off links, JSON-LD scripts, charset/viewport) belongs to native React
    19 tags or the app's document shell, not here.

    The mechanics that make this correct under SSR and concurrent React:

      - Declarations register during *render* (`set`), because a Suspense-awaiting
        prerender runs no effects — by the time the prerender drains, every `<Title>`
        inside a resolved route has spoken. The server reads winners after prerender
        (`headTags` in rati/ssr) with `snapshot('server')`.
      - On the client, an effect re-registers and *confirms* the entry (`commit`), and
        winners count only confirmed entries — a render React abandoned (an interrupted
        transition) can register but never commit, so it can't leak a winner. `set`
        never mutates a confirmed entry for the same reason; committed values change
        only through `commit`, one commit behind the render — invisibly.
      - Dedupe is a registration sequence: last registered = deepest in the tree (React
        renders parent before child) = the winner per dedupe key. A value update keeps
        the entry's seq so a re-rendering layout can't steal the win from a page.
      - One store per rendered tree — on the server, per request; never a module
        global, or concurrent requests clobber each other's heads.

    The phase (`hydrating` → `live`, one-way) exists because "nothing declared yet" and
    "nothing will be declared" are the same state to the entries above, and on a
    server-rendered page they call for opposite acts. HeadProvider sits above the routes'
    Suspense boundaries, so its first apply can run while the page that declares the
    title is still unhydrated: no entry is confirmed, and writing `defaultTitle` (or
    reconciling away the server's metas) would destroy a correct head. So while
    `hydrating` the document is the server's — see domSync.ts. `remove()` settles the
    store: an unmount can only follow that subtree's hydration, and it is the earliest
    signal the head is churning (a navigation, a conditional declaration leaving).
    `commit()` does not — on a multi-boundary page one boundary's commit says nothing
    about its siblings. A page rati never server-rendered has no server head to protect;
    HeadProvider detects that (no marked tags in the document) and `settle()`s on mount,
    so a client-only app is unaffected by any of this.

    (In StrictMode's simulated remount the cleanup `remove()`s and settles early. Dev
    only, and it lands on today's behavior — the pre-phase one — for the rest of the
    page's life.)
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
 * One-way — see the phase note above.
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
     * Idempotent per id, and a no-op on confirmed entries (see the module comment).
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
     * committing. Settles the phase — but only on a real removal: `useHeadTag(null)`
     * calls this on mount for a declaration that never registered, and that is not a
     * head that has started churning.
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
     * Compute the winners for one reader:
     *
     *   - `'server'` counts every registration — prerender runs no effects, and its
     *     single pass has no abandoned trees to guard against.
     *   - `'client'` counts only effect-confirmed entries (abandoned renders never
     *     confirm), and falls back to `defaultTitle`.
     *   - `'hydrating'` is `'client'` minus the default: an undeclared title means
     *     "nobody has hydrated yet", so there is nothing to say and the server's
     *     `<title>` stands (the phase note above).
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
