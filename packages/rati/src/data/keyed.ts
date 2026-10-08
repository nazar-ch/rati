import { observable, runInAction } from 'mobx';

/*
    `keyed` — the lazy per-key instance map (◊DATA-14): `get(key)` returns one instance per key
    forever, so `mutation`'s `refreshes` reaches exactly the one a call invalidated. It is
    primitive-agnostic, and a map, not a cache — no eviction, no TTL.
*/

/** Keys are used as `Map` keys, so identity is `===` — branded strings pass. */
export type KeyedKey = string | number;

export interface Keyed<K extends KeyedKey, I> {
    /**
     * Get-or-create: the first call for a key runs the factory, every later one
     * returns that same instance. Creating is a write, so call this from an
     * action, an event handler or a scope load — never inside a `computed`, which
     * must not cause side effects (read with `peek` there).
     */
    get(key: K): I;
    /**
     * The read-side twin: the instance if one exists, `undefined` otherwise —
     * it never creates. Reactive: a derivation that peeks a missing key re-runs
     * once `get` creates it.
     */
    peek(key: K): I | undefined;
    /**
     * Drops one instance, the caller knowing the key is spent — on request, never an
     * eviction policy. Like `reset`, it does not call into the instance; returns whether the
     * key was present.
     */
    delete(key: K): boolean;
    /**
     * Drops every instance (the sign-out case) without calling into them: dropping the
     * references IS the semantics. The next `get` builds a fresh instance.
     */
    reset(): void;
}

export function keyed<K extends KeyedKey, I>(factory: (key: K) => I): Keyed<K, I> {
    // An observable map (not a plain one) so `peek` is reactive both ways: MobX
    // tracks a MISSING key too, so a derivation that peeked nothing re-runs
    // when the instance appears.
    const instances = observable.map<K, I>(undefined, { deep: false });

    return {
        get(key) {
            const existing = instances.get(key);
            // `has` rather than `!== undefined`: `I` may legitimately be a
            // nullish value, and re-running the factory would break identity.
            if (instances.has(key)) return existing as I;
            // The factory runs outside the action: it typically constructs a
            // query/collection/store, and whatever it kicks off (a `prime()`,
            // say) must not be silently batched into our write.
            const created = factory(key);
            runInAction(() => {
                instances.set(key, created);
            });
            return created;
        },
        peek(key) {
            return instances.get(key);
        },
        delete(key) {
            return runInAction(() => instances.delete(key));
        },
        reset() {
            runInAction(() => {
                instances.clear();
            });
        },
    };
}
