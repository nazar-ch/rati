import { comparer, isObservableObject, observable, runInAction } from 'mobx';

/*
    The shared identity map under `collection` and `pagedCollection` — one
    reconciler, one identity story (package-internal).

    Reconcile-on-refresh: match new rows to existing items by `key`; unchanged
    rows (per `equals`) keep their item instance untouched; changed rows update
    the existing instance's observable fields in place, so only observers of
    that item re-render. Order comes from the fresh result; the `items` array
    reference swaps only when membership/order/identity actually moved.
*/

export interface ItemMapOptions<T, Item> {
    key: (raw: T) => string;
    /** Row equality deciding "unchanged → untouched". Default: `comparer.shallow`. */
    equals?: (a: T, b: T) => boolean;
    /**
     * Wrap rows in app instances with behavior, preserving them across refreshes:
     * `(raw, prev) => (prev ? prev.update(raw) : new Row(raw))`. Per-item UI
     * state (expanded, editing) lives on the item and survives refresh. Without
     * it, plain-object rows become shallow-observable items updated field-by-field
     * in place (the default nested reactivity); non-object rows are kept as-is
     * and replaced on change.
     */
    into?: (raw: T, prev: Item | undefined) => Item;
}

interface Entry<T, Item> {
    raw: T;
    item: Item;
    /** Patched locally — the next reconcile must reapply server truth. */
    dirty: boolean;
}

export interface ItemMap<T, Item> {
    readonly items: readonly Item[];
    getByKey(key: string): Item | undefined;
    /** Full-result reconcile; call inside an action. */
    reconcile(rows: readonly T[]): void;
    patch(key: string, patchFn: (item: Item) => Item | void): void;
    upsert(raw: T): void;
    insert(raw: T, at?: number): void;
    remove(key: string): void;
    clear(): void;
}

export function itemMap<T, Item>(options: ItemMapOptions<T, Item>): ItemMap<T, Item> {
    const equalsFn = options.equals ?? ((a: T, b: T) => comparer.shallow(a, b));
    const state = observable(
        { items: [] as readonly Item[] },
        { items: observable.ref },
        { deep: false },
    );
    let entries = new Map<string, Entry<T, Item>>();

    function createItem(raw: T): Item {
        if (options.into) return options.into(raw, undefined);
        if (isPlainObject(raw)) {
            return observable.object(raw as T & object, {}, { deep: false }) as Item;
        }
        return raw as unknown as Item;
    }

    function updateItem(raw: T, entry: Entry<T, Item>): Item {
        if (options.into) return options.into(raw, entry.item);
        if (isObservableObject(entry.item)) {
            assignRow(entry.item as object, raw as object);
            return entry.item;
        }
        return raw as unknown as Item;
    }

    function replaceInItems(prevItem: Item, nextItem: Item): void {
        state.items = state.items.map((item) => (item === prevItem ? nextItem : item));
    }

    const self: ItemMap<T, Item> = {
        get items() {
            return state.items;
        },
        getByKey(key) {
            return entries.get(key)?.item;
        },
        reconcile(rows) {
            const prevItems = state.items;
            const nextEntries = new Map<string, Entry<T, Item>>();
            const nextItems: Item[] = [];
            let changed = false;
            for (const raw of rows) {
                const key = options.key(raw);
                if (nextEntries.has(key)) continue; // duplicate key: first occurrence wins
                const prev = entries.get(key);
                let item: Item;
                if (!prev) item = createItem(raw);
                else if (!prev.dirty && equalsFn(prev.raw, raw)) item = prev.item;
                else item = updateItem(raw, prev);
                if (item !== prevItems[nextItems.length]) changed = true;
                nextItems.push(item);
                nextEntries.set(key, { raw, item, dirty: false });
            }
            if (nextItems.length !== prevItems.length) changed = true;
            entries = nextEntries;
            // Don't churn on a no-op recompute: the array reference is the list's
            // render identity.
            if (changed) state.items = nextItems;
        },
        patch(key, patchFn) {
            runInAction(() => {
                const entry = entries.get(key);
                if (!entry) return;
                const result = patchFn(entry.item);
                entry.dirty = true;
                if (result !== undefined && result !== entry.item) {
                    replaceInItems(entry.item, result);
                    entry.item = result;
                }
            });
        },
        upsert(raw) {
            runInAction(() => {
                const key = options.key(raw);
                const entry = entries.get(key);
                if (!entry) {
                    const item = createItem(raw);
                    entries.set(key, { raw, item, dirty: false });
                    state.items = [...state.items, item];
                    return;
                }
                if (!entry.dirty && equalsFn(entry.raw, raw)) {
                    entry.raw = raw;
                    return;
                }
                const prevItem = entry.item;
                const item = updateItem(raw, entry);
                entry.raw = raw;
                entry.item = item;
                entry.dirty = false;
                if (item !== prevItem) replaceInItems(prevItem, item);
            });
        },
        insert(raw, at) {
            runInAction(() => {
                const key = options.key(raw);
                if (entries.has(key)) {
                    self.upsert(raw); // keep its position
                    return;
                }
                const item = createItem(raw);
                entries.set(key, { raw, item, dirty: false });
                const next = [...state.items];
                next.splice(at ?? next.length, 0, item);
                state.items = next;
            });
        },
        remove(key) {
            runInAction(() => {
                const entry = entries.get(key);
                if (!entry) return;
                entries.delete(key);
                state.items = state.items.filter((item) => item !== entry.item);
            });
        },
        clear() {
            entries = new Map();
            state.items = [];
        },
    };
    return self;
}

function isPlainObject(value: unknown): value is object {
    if (value === null || typeof value !== 'object') return false;
    const proto: unknown = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
}

/** Field-level in-place update: assign changed props, drop the vanished ones. */
function assignRow(target: object, next: object): void {
    const targetRecord = target as Record<string, unknown>;
    const nextRecord = next as Record<string, unknown>;
    for (const key of Object.keys(nextRecord)) {
        if (!Object.is(targetRecord[key], nextRecord[key])) targetRecord[key] = nextRecord[key];
    }
    for (const key of Object.keys(targetRecord)) {
        if (!(key in nextRecord)) delete targetRecord[key];
    }
}
