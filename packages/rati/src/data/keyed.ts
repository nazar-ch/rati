import { observable, runInAction } from 'mobx';

/*
    `keyed` — the lazy per-key instance map: the ~20 lines every keyed resource
    hand-rolled (`Map<key, instance>` + get-or-create) hoisted into the package.
    Design record: docs/planned/data-package/issues/DATA-14-keyed-factory.md.

      - Deliberately **primitive-agnostic**: the factory returns whatever you
        build — a `query` of a composite payload, a `collection`, a
        `pagedCollection`, or a store class stitching several together. `keyed`
        knows nothing about any of them and never calls into them.
      - It is a **map, not a cache**: no eviction, no TTL, no LRU, and no
        cross-key identity (two keys returning rows for the same entity are two
        independent instances). An unbounded key space wants a selection —
        one instance whose parameters change — not this.
      - Per-key identity is the contract: `get(key)` returns the same instance
        for the same key forever, so `mutation`'s `refreshes: (id) => [...]` can
        point at exactly the instance a call invalidated.
*/

/** Keys are used as `Map` keys, so identity is `===` — branded strings pass. */
export type KeyedKey = string | number;

export interface Keyed<K extends KeyedKey, I> {
    /**
     * Get-or-create: the first call for a key runs the factory, every later one
     * returns that same instance. Creating is a write, so call this from an
     * action, an event handler or a scope load — not from inside a `computed`,
     * which may not cause side effects (read with `peek` there).
     */
    get(key: K): I;
    /**
     * The read-side twin: the instance if one exists, `undefined` otherwise —
     * it never creates. Reactive: a derivation that peeks a missing key re-runs
     * once `get` creates it.
     */
    peek(key: K): I | undefined;
    /**
     * Drop every instance (the sign-out case). It deliberately does **not**
     * call into the instances — dropping the references *is* the semantics, and
     * a caller still holding one resets it itself. The next `get` for a key
     * builds a fresh instance.
     */
    reset(): void;
}

export function keyed<K extends KeyedKey, I>(factory: (key: K) => I): Keyed<K, I> {
    // An observable map (not a plain one) so `peek` is reactive both ways: MobX
    // tracks a *missing* key too, so a derivation that peeked nothing re-runs
    // when the instance appears.
    const instances = observable.map<K, I>(undefined, { deep: false });

    return {
        get(key) {
            const existing = instances.get(key);
            // `has` rather than `!== undefined`: `I` may legitimately be a
            // nullish value, and re-running the factory would break identity.
            if (instances.has(key)) return existing as I;
            // The factory runs outside the action: it typically constructs a
            // query/collection/store, and whatever it kicks off (a `load()`,
            // say) shouldn't be silently batched into our write.
            const created = factory(key);
            runInAction(() => {
                instances.set(key, created);
            });
            return created;
        },
        peek(key) {
            return instances.get(key);
        },
        reset() {
            runInAction(() => {
                instances.clear();
            });
        },
    };
}
