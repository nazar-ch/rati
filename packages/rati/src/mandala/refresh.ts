import { isHookLoad, type Scope } from '../scope/scope';
import type { Source, SourceError } from '../scope/source';
import { deepEqual } from '../util/utils';

/*
    Selective scope refresh — the cell model and the per-mandala controller behind
    `useScopeControls`.

    `refresh(key)` re-runs one promise load without tearing the island down: the cell is
    marked dirty, the next render re-runs its producer with the *current* upstream values
    (so the re-run happens where `prev` naturally lives — in the Step's render, same as
    the initial build), and the previous value stays rendered while the re-fetch is in
    flight. On settle the new value passes the equals gate (deep by default — a re-fetch
    of identical JSON is dropped on the floor, old identity kept); a changed value swaps
    in and marks dirty exactly the downstream cells whose producers read the key — the
    read-sets recorded by `trackReads` when each producer ran. Downstream re-runs cascade
    through the same machinery.

    Only promise loads are refreshable: sources are live and refresh themselves (the
    data-layer division of labor), hook loads re-run every render anyway, and static
    entries have no producer to re-run. A cascade may still *re-create* a downstream
    source or `.provide()` value whose producer consumed a changed key — the narrow
    equivalent of what a full remount does today.
*/

export type EqualsFn = (previous: unknown, next: unknown) => boolean;

type CellBase = {
    // Keys of prior levels the producer read on its last run (recorded by trackReads);
    // null for static entries (bare promise/source/value/input) — nothing to re-run.
    reads: Set<string> | null;
    // Producer-backed (function/class entry) — re-runnable on refresh/cascade.
    rerunnable: boolean;
    // The refresh gate (from `data(fn, { equals })`); undefined → deepEqual.
    equals: EqualsFn | undefined;
    // Selective-refresh bookkeeping: `dirty` asks the next render to re-run the
    // producer; `refreshing.token` guards against superseded re-runs (latest wins).
    dirty: boolean;
    refreshing: { token: number } | null;
    // The last value the resolve pass handed down — the stale content a refresh keeps
    // rendering while in flight, and the old side of the equals gate.
    lastValue: unknown;
    hasValue: boolean;
    // A cascade re-created this (still-pending) source; render the stale lastValue
    // until its first ready instead of dropping the level to the loading slot.
    swapped?: boolean;
    // Server only: how the resolved value goes on the wire — a plain dehydrated value,
    // or a live-source seed (the input of `source.ssr.hydrate` on the client).
    dehydrate?: ((value: unknown) => unknown) | undefined;
    collectAs?: 'value' | 'seed';
};

// One resolved cell. Props/classes/plain values resolve instantly; a function is
// called with the prior levels' ready values and its result re-classified; a promise
// is unwrapped with `use()`; a source is read observably. A refreshed promise cell
// becomes a value cell when the re-fetch settles (the settled value renders
// synchronously — no `use()`, no Suspense re-entry, no loading-slot flash).
//
// `error` is the fourth outcome, and the only one a load never *produces*: it is a
// failure the server already had, dehydrated across the wire (`ssrErrors: 'dehydrate'`).
// The cell lands in it — `SourceState`'s third member, in cell clothing — and the resolve
// pass throws it to the boundary without the load having run here at all.
export type Cell = CellBase &
    (
        | { kind: 'value'; value: unknown }
        | { kind: 'promise'; promise: Promise<unknown> }
        | { kind: 'source'; source: Source<unknown> }
        | { kind: 'error'; error: SourceError }
    );

export type CellBody =
    | { kind: 'value'; value: unknown }
    | { kind: 'promise'; promise: Promise<unknown> }
    | { kind: 'source'; source: Source<unknown> }
    | { kind: 'error'; error: SourceError };

/** What a load can *produce* — everything but `error`, which is never classified from an
 *  entry: it only ever arrives dehydrated from a server render. */
export type ProducedBody = Exclude<CellBody, { kind: 'error' }>;
export type ProducedCell = CellBase & ProducedBody;

// Generic in the body so a caller that knows which kind it built keeps that knowledge —
// the classifier's "never an error cell" above is the one that matters.
export function makeStaticCell<Body extends CellBody>(body: Body): CellBase & Body {
    return {
        ...body,
        reads: null,
        rerunnable: false,
        equals: undefined,
        dirty: false,
        refreshing: null,
        lastValue: undefined,
        hasValue: false,
    };
}

export function makeProducedCell<Body extends CellBody>(
    body: Body,
    reads: Set<string>,
    equals: EqualsFn | undefined,
): CellBase & Body {
    return {
        ...body,
        reads,
        rerunnable: true,
        equals,
        dirty: false,
        refreshing: null,
        lastValue: undefined,
        hasValue: false,
    };
}

export type SourceEntry = { source: Source<unknown>; detach: (() => void) | null };

// One level's data cells, built once. Lives on the mandala's committed ref (not the
// Step's fiber) so it survives a `use()` suspension: a suspended render is discarded,
// which would otherwise re-build the cell — re-running its load and re-suspending on a
// brand-new promise forever. Built per level here; the load side effect runs once.
// `sources` is replaced (new array identity) when a cascade swaps a source, so the
// Step's attach/detach effects and uSES subscription re-key. `abort` is the level's
// cancellation handle — see `bucketSignal` / `discardRun`.
export type Bucket = {
    cells: Map<string, Cell>;
    sources: SourceEntry[];
    built: boolean;
    abort: AbortController | null;
};

/**
 * The `AbortSignal` this level's loads receive (the `signal` of their `LoadContext`) —
 * one controller per bucket, i.e. per level per run, created with the level's cells. The
 * bucket is exactly the right lifetime: it is built once per inner-tree generation and
 * discarded wholesale when that generation is (`discardRun`), so the signal fires when —
 * and only when — the loads it covers have lost their reader.
 */
export function bucketSignal(bucket: Bucket): AbortSignal {
    bucket.abort ??= new AbortController();
    return bucket.abort.signal;
}

/**
 * Record which keys of `prev` a producer reads while it runs. Destructuring — the
 * dominant load idiom — reads eagerly at call time, so for `({ a, b }) => …` the set is
 * deterministic and complete; lazy styles (`(bag) => bag.a`) are recorded per run and
 * re-recorded on every re-run (same rule as any tracked derivation).
 */
export function trackReads(prev: Record<string, unknown>): {
    proxy: Record<string, unknown>;
    reads: Set<string>;
} {
    const reads = new Set<string>();
    const proxy = new Proxy(prev, {
        get(target, prop, receiver) {
            if (typeof prop === 'string') reads.add(prop);
            return Reflect.get(target, prop, receiver);
        },
        has(target, prop) {
            if (typeof prop === 'string') reads.add(prop);
            return Reflect.has(target, prop);
        },
    });
    return { proxy, reads };
}

/**
 * Let a torn-down generation go: abort the loads it still has in flight, then detach the
 * sources it still has attached. Called wherever a run is discarded — the buckets a new
 * generation replaced (an inputs change, a retry, `refresh()`) and the mandala's unmount
 * — never on a plain re-render, where the run is still the live one.
 *
 * Effect-time on purpose, like the detach half it wraps: a *discarded render* must not
 * cancel the loads of a run that is still current.
 */
export function discardRun(buckets: readonly Bucket[] | null | undefined): void {
    if (!buckets) return;
    for (const bucket of buckets) abortLoads(bucket);
    sweepDetach(buckets);
}

// Fire one bucket's controller. A load that took the signal rejects as a result, and
// that rejection has no reader left — the Step that `use()`d the promise is gone, and a
// refresh settle is dropped by token — so it would surface as an unhandled rejection.
// Each producer-backed promise therefore gets a no-op rejection handler *before* the
// abort, which is what keeps the runtime quiet (attaching one afterwards is already too
// late). Static promise entries are left alone: they never received the signal, so this
// can't be what rejects them, and marking a shared module-level promise as handled
// forever is not ours to do.
function abortLoads(bucket: Bucket): void {
    const controller = bucket.abort;
    if (!controller || controller.signal.aborted) return;
    for (const cell of bucket.cells.values()) {
        if (cell.kind === 'promise' && cell.rerunnable) {
            void cell.promise.then(undefined, () => {});
        }
    }
    // No reason argument: `signal.reason` stays the standard AbortError DOMException, so
    // the `error.name === 'AbortError'` check every fetch wrapper already has holds.
    controller.abort();
}

/** Detach every still-attached source in the given buckets (the mandala's unmount
 * sweep — Step cleanups keep live entries, see the resolver's detach effect). */
export function sweepDetach(buckets: readonly Bucket[] | null | undefined): void {
    if (!buckets) return;
    for (const bucket of buckets) {
        for (let i = bucket.sources.length - 1; i >= 0; i--) {
            const entry = bucket.sources[i]!;
            if (entry.detach) {
                try {
                    entry.detach();
                } catch (error) {
                    console.error('Source detach failed', error);
                }
                entry.detach = null;
            }
        }
    }
}

/**
 * Which of the island's three slots is on screen — its aggregate phase, not any one load's.
 * `'ready'` means content is rendering, which includes the stale window: kept content *is*
 * content, and a subtree gating a skeleton on `phase === 'loading'` must not flip back to
 * it under content the user is reading. `isStale` is what tells the two apart.
 */
export type IslandPhase = 'loading' | 'ready' | 'error';

/** The island's status, as `useScopeControls` reports it. */
export type IslandStatus = { phase: IslandPhase; isStale: boolean; retrying: number };

const initialStatus: IslandStatus = { phase: 'loading', isStale: false, retrying: 0 };

type ControllerWiring = {
    levels: Scope['definition'][];
    buckets: Bucket[];
    treeKey: string;
    /** Bare re-render of the mandala (picks up dirty cells / swapped values). */
    notify: () => void;
    /** Whole-scope re-resolve — the retry bump (inner tree remounts). */
    fullRefresh: () => void;
};

/**
 * One per mandala instance. Owns the refresh bookkeeping over the instance's buckets:
 * marking cells dirty, tracking in-flight re-runs, gating settles, fanning changes out
 * to dependents, and the `pending` external store `useScopeControls` reads. Wired every
 * render (buckets change identity per inner tree); handed to the subtree through the
 * scope-keyed controls channel.
 */
export class RefreshController {
    private wiring: ControllerWiring | null = null;
    private committedTreeKey: string | null = null;
    private tokens = 0;

    private readonly pendingKeys = new Set<string>();
    private pendingSnapshot: ReadonlySet<string> = new Set();
    private readonly pendingListeners = new Set<() => void>();
    private notifyScheduled = false;

    private readonly changedListeners = new Set<(key: string) => void>();
    private readonly waiters = new Map<string, Array<() => void>>();

    private status: IslandStatus = initialStatus;
    private readonly statusListeners = new Set<() => void>();
    private statusNotifyScheduled = false;

    wire(wiring: ControllerWiring): void {
        this.wiring = wiring;
    }

    /**
     * Whatever is rendering says so — the leaf ('ready'), the kept run ('ready', stale), the
     * loading slot, the error slot. Which slot is on screen is the only honest definition of
     * the island's phase: no single piece of bookkeeping knows it (a level can be suspended
     * on a promise, pending on a source, or thrown to the boundary, all without the mandala
     * itself re-rendering).
     *
     * Called from render, like `addPending` — so a subtree reading the status further down
     * the same pass sees the value that pass produced, rather than the previous one. The
     * notification is microtask-deferred for the same reason it is there: a listener
     * setState during render is not allowed.
     */
    reportPhase(phase: IslandPhase, isStale: boolean): void {
        if (this.status.phase === phase && this.status.isStale === isStale) return;
        // `retrying` is carried, not replaced: it belongs to the automatic retry policy,
        // which reports on its own clock (see reportRetrying) and is orthogonal to which
        // slot happens to be up.
        this.status = { phase, isStale, retrying: this.status.retrying };
        this.statusChanged();
    }

    /**
     * The automatic retry policy's half of the status: which attempt is in flight, 0 when
     * none is. Called from the boundary's render (accepting a failure) and from the
     * policy's own settles — the same render-time-with-deferred-notify shape as above.
     */
    reportRetrying = (attempt: number): void => {
        if (this.status.retrying === attempt) return;
        this.status = { ...this.status, retrying: attempt };
        this.statusChanged();
    };

    private statusChanged(): void {
        if (this.statusNotifyScheduled) return;
        this.statusNotifyScheduled = true;
        queueMicrotask(() => {
            this.statusNotifyScheduled = false;
            for (const listener of this.statusListeners) listener();
        });
    }

    subscribeStatus = (onChange: () => void): (() => void) => {
        this.statusListeners.add(onChange);
        return () => {
            this.statusListeners.delete(onChange);
        };
    };

    getStatus = (): IslandStatus => this.status;

    /** The error slot's retry, as a verb the whole subtree can reach. */
    retry = (): void => {
        this.wiring?.fullRefresh();
    };

    /** Effect-time, on inner-tree commit: a remount (inputs change / retry) tears the
     * old cells down, so outstanding refresh bookkeeping is settled wholesale. */
    treeCommitted(treeKey: string): void {
        if (this.committedTreeKey === treeKey) return;
        this.committedTreeKey = treeKey;
        if (this.pendingKeys.size) {
            this.pendingKeys.clear();
            this.pendingChanged();
        }
        for (const list of this.waiters.values()) {
            for (const resolve of list) resolve();
        }
        this.waiters.clear();
    }

    refresh = (key?: string): Promise<void> => {
        const wiring = this.wiring;
        if (!wiring) return Promise.resolve();
        if (key === undefined) {
            wiring.fullRefresh();
            return Promise.resolve();
        }
        const cell = this.locate(key);
        if (!cell) return Promise.resolve();
        if (cell.kind === 'source') {
            console.warn(
                `[rati] refresh('${key}'): the key resolves a source — sources are live and ` +
                    `refresh themselves; ignoring.`,
            );
            return Promise.resolve();
        }
        if (cell.kind === 'error') {
            // A dehydrated server-side failure (`ssrErrors: 'dehydrate'`). The island is
            // showing its error slot, so nothing under it renders and a per-key re-run
            // would never get the chance to happen — resolving the island again is the
            // way back, which is what the slot's own `retry` does.
            console.warn(
                `[rati] refresh('${key}'): the load failed during the server render and the ` +
                    `island is showing its error slot — use retry() to resolve it again; ignoring.`,
            );
            return Promise.resolve();
        }
        if (!cell.rerunnable) {
            console.warn(
                `[rati] refresh('${key}'): a static entry with no producer to re-run; ignoring.`,
            );
            return Promise.resolve();
        }
        cell.dirty = true;
        this.addPending(key);
        wiring.notify();
        return new Promise((resolve) => {
            const list = this.waiters.get(key) ?? [];
            list.push(resolve);
            this.waiters.set(key, list);
        });
    };

    private locate(key: string): Cell | null {
        const wiring = this.wiring;
        if (!wiring) return null;
        for (const bucket of wiring.buckets) {
            if (!bucket.built) continue;
            const cell = bucket.cells.get(key);
            if (cell) return cell;
        }
        for (const level of wiring.levels) {
            if (key in level) {
                console.warn(
                    isHookLoad(level[key])
                        ? `[rati] refresh('${key}'): hook loads run every render — nothing to refresh; ignoring.`
                        : `[rati] refresh('${key}'): its level has not resolved yet; ignoring.`,
                );
                return null;
            }
        }
        console.warn(`[rati] refresh('${key}'): no load with this key in the scope; ignoring.`);
        return null;
    }

    nextToken(): number {
        return ++this.tokens;
    }

    /** Render-time: a dirty re-run produced a promise — track its settle. */
    trackRefresh(levelIndex: number, key: string, promise: Promise<unknown>, token: number): void {
        this.addPending(key);
        void promise.then(
            (value) => {
                this.settled(levelIndex, key, value, token);
            },
            (error: unknown) => {
                this.refreshFailed(levelIndex, key, error, token);
            },
        );
    }

    private settled(levelIndex: number, key: string, value: unknown, token: number): void {
        const wiring = this.wiring;
        const bucket = wiring?.buckets[levelIndex];
        const cell = bucket?.cells.get(key);
        // Superseded re-run or a torn-down tree: the token no longer matches.
        if (!wiring || !bucket || !cell || cell.refreshing?.token !== token) return;
        cell.refreshing = null;
        const equals = cell.equals ?? deepEqual;
        const changed = !(cell.hasValue && equals(cell.lastValue, value));
        if (changed) {
            // Swap to a value cell: the settled value renders synchronously — no
            // `use()` on a fresh promise, so no Suspense re-entry / loading flash.
            bucket.cells.set(key, {
                kind: 'value',
                value,
                reads: cell.reads,
                rerunnable: cell.rerunnable,
                equals: cell.equals,
                dirty: false,
                refreshing: null,
                lastValue: cell.lastValue,
                hasValue: cell.hasValue,
                dehydrate: cell.dehydrate,
                ...(cell.collectAs !== undefined && { collectAs: cell.collectAs }),
            });
            this.markDependents(levelIndex, key);
            this.emitChanged(key);
            wiring.notify();
        }
        this.removePending(key);
        this.settleWaiters(key);
    }

    private refreshFailed(levelIndex: number, key: string, error: unknown, token: number): void {
        const bucket = this.wiring?.buckets[levelIndex];
        const cell = bucket?.cells.get(key);
        if (!cell || cell.refreshing?.token !== token) return;
        cell.refreshing = null;
        // A cancelled re-fetch is not a failed one: the run this re-run belonged to was
        // discarded (unmount, mostly — a remount re-wires the controller onto the new
        // buckets, so the old cell isn't even found) and took the load with it. Nothing
        // to report; the bookkeeping below still settles so an awaited `refresh()` resolves.
        if (!bucket?.abort?.signal.aborted) {
            console.error(`[rati] refresh('${key}') failed — keeping the previous value.`, error);
        }
        this.removePending(key);
        this.settleWaiters(key);
    }

    /** Mark dirty every later-level cell whose producer read `key`. Dependents can only
     * live below: a level's producers see prior levels, never siblings. */
    markDependents(levelIndex: number, key: string): void {
        const wiring = this.wiring;
        if (!wiring) return;
        for (let i = levelIndex + 1; i < wiring.buckets.length; i++) {
            const bucket = wiring.buckets[i]!;
            if (!bucket.built) continue;
            for (const cell of bucket.cells.values()) {
                if (cell.rerunnable && cell.reads?.has(key)) cell.dirty = true;
            }
        }
    }

    /** Render-time: a sync value re-run changed. Dependents sit in later levels, which
     * render after this one in the same pass and pick the dirty flags up. */
    valueChanged(levelIndex: number, key: string): void {
        this.markDependents(levelIndex, key);
        this.emitChanged(key);
    }

    /** Render-time: a dirty re-run resolved synchronously (value or source swap). */
    syncSettled(key: string): void {
        this.removePending(key);
        this.settleWaiters(key);
    }

    /** Render-time: a cascade swapped a source in; pending until its first ready. */
    sourceSwapped(key: string): void {
        this.addPending(key);
    }

    /** Render-time: a swapped source produced its first ready snapshot — the swap is over.
     * Whether anything downstream moves is `valueChanged`'s call (the resolver runs the
     * same equals gate on the new snapshot), so this is bookkeeping only. */
    sourceReady(key: string): void {
        this.removePending(key);
        this.settleWaiters(key);
    }

    /** Render-time: a swapped source errored instead — equally the end of the swap. An
     * error is a settled state, not an in-flight one, so the key leaves `pending` before
     * the boundary takes the tree; without this it sat there until a retry's
     * `treeCommitted`, and the error slot read a `pending` with nothing actually fetching. */
    sourceErrored(key: string): void {
        this.removePending(key);
        this.settleWaiters(key);
    }

    // The `pending` external store (uSES-shaped). Mutations may happen during render
    // (dirty processing), so listener notification is microtask-deferred — never a
    // setState-during-render — and the snapshot is rebuilt per change for identity.
    subscribePending = (onChange: () => void): (() => void) => {
        this.pendingListeners.add(onChange);
        return () => {
            this.pendingListeners.delete(onChange);
        };
    };

    getPending = (): ReadonlySet<string> => this.pendingSnapshot;

    private addPending(key: string): void {
        if (this.pendingKeys.has(key)) return;
        this.pendingKeys.add(key);
        this.pendingChanged();
    }

    private removePending(key: string): void {
        if (!this.pendingKeys.delete(key)) return;
        this.pendingChanged();
    }

    private pendingChanged(): void {
        this.pendingSnapshot = new Set(this.pendingKeys);
        if (this.notifyScheduled) return;
        this.notifyScheduled = true;
        queueMicrotask(() => {
            this.notifyScheduled = false;
            for (const listener of this.pendingListeners) listener();
        });
    }

    /** A key's value changed (settle swap, sync re-run, source first-ready) — the
     * `.provide()` leaf listens to rebuild when its factory consumed the key. */
    subscribeChanged = (listener: (key: string) => void): (() => void) => {
        this.changedListeners.add(listener);
        return () => {
            this.changedListeners.delete(listener);
        };
    };

    private emitChanged(key: string): void {
        // Microtask-deferred: emits fire from render (sync cascades) as well as from
        // settle callbacks; subscribers setState.
        queueMicrotask(() => {
            for (const listener of this.changedListeners) listener(key);
        });
    }

    private settleWaiters(key: string): void {
        const list = this.waiters.get(key);
        if (!list) return;
        this.waiters.delete(key);
        for (const resolve of list) resolve();
    }
}
