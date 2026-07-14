import {
    use,
    useEffect,
    useLayoutEffect,
    useMemo,
    useReducer,
    useRef,
    useState,
    useSyncExternalStore,
} from 'react';
import type { ComponentType, Context, ReactNode } from 'react';
import {
    isDataLoad,
    isHookLoad,
    InputSymbol,
    type HookLoad,
    type Scope,
    type ScopeProvideDef,
} from '../scope/scope';
import { asSourceError, isSource, type SourceError, type SourceState } from '../scope/source';
import { is, deepEqual } from '../util/utils';
import { navTrace, navTraceEnabled } from '../util/navTrace';
import {
    makeProducedCell,
    makeStaticCell,
    trackReads,
    type Bucket,
    type Cell,
    type CellBody,
    type EqualsFn,
    type RefreshController,
} from './refresh';
import { firstSettle } from './ssrSource';

/*
    The mandala's resolution mechanics: compile a scope's levels into a nested tree of
    `Step` components — one per level — and let React be the resolver.

      - Waterfall = nesting. Each `Step` resolves its level and renders the next once
        ready; the leaf provides the value to the subtree and renders the component.
      - every entry ready  → the main component, fed each entry's value;
      - any entry errored  → the error slot (one slot: not-available / forbidden /
                             failed all arrive as a SourceError, switch on `code`);
      - otherwise          → the loading slot.

    Resolution runs on React mechanics so it works under SSR:

      - a *promise* entry is unwrapped with `use()` — it suspends while pending (the
        Suspense fallback is the loading slot) and a Suspense-aware server render
        (react-dom/static `prerender`) awaits it. Rejections throw to the mandala's
        ErrorBoundary → the error slot.
      - a *source* entry (a reactive `pending | ready | error` state machine) is read
        observably; pending renders the loading slot, error throws to the slot. A ready
        source returning to pending drops back to loading, live. Under SSR an unmarked
        source stays pending (no server resolution); a source carrying the `ssr` marker
        is resolved server-side through the promise path (see `firstSettle`) and its
        value dehydrated — as a plain value for a loader (`ssr: true`), or as a seed the
        client feeds to `source.ssr.hydrate` before attaching (a live source).
      - a *hook* load (`hook(fn)`) runs every render so `fn` may call any React hook;
        it's the seam that lets a level read its own deps (`use(StoresContext)`) — the
        reason `env` is gone. Its result is classified like a function load. rati never
        attaches/detaches a hook source; the hook owns its own subscription.

    Lifetime is React's: each `Step` attaches its level's *data* sources in an effect
    and detaches on unmount; a param change remounts the inner tree, so React tears the
    old one down (children first → the leaf's `.provide()` value disposes before the
    sources it was built over detach) and mounts a fresh one.

    Selective refresh (`useScopeControls().refresh(key)`) re-runs single cells in place —
    the model and controller live in refresh.ts; the render-side halves (dirty re-runs,
    stale rendering, source swaps) live here.
*/

// ---------------------------------------------------------------------------------------

// Flatten the scope's prevScope links into ordered levels (level 0 first).
export function flattenLevels(scope: Scope): Scope['definition'][] {
    const levels: Scope['definition'][] = [];
    for (let current: Scope | undefined = scope; current; current = current.prevScope) {
        levels.unshift(current.definition);
    }
    return levels;
}

// hook keys vs data keys per level — static (a level is frozen at build time), so
// memoized once per level object. `hook()` loads run every render; everything else
// (props, functions, promises, sources, classes, values) is a cached data load.
const partitionCache = new WeakMap<object, { hookKeys: string[]; dataKeys: string[] }>();
function partition(level: Scope['definition']): { hookKeys: string[]; dataKeys: string[] } {
    let parts = partitionCache.get(level);
    if (!parts) {
        const hookKeys: string[] = [];
        const dataKeys: string[] = [];
        for (const key of Object.keys(level)) {
            if (isHookLoad(level[key])) hookKeys.push(key);
            else dataKeys.push(key);
        }
        parts = { hookKeys, dataKeys };
        partitionCache.set(level, parts);
    }
    return parts;
}

// Classify a *data entry* (the value written in the scope definition) into a cell.
// Function/class producers run against a read-tracking proxy of the prior levels'
// values — the recorded read-set is what a selective refresh cascades along.
function classifyEntry(entry: unknown, prev: Record<string, unknown>, key: string): Cell {
    if (is.object(entry) && InputSymbol in entry) {
        return makeStaticCell({ kind: 'value', value: prev[key] });
    }
    if (is.promise(entry)) return makeStaticCell({ kind: 'promise', promise: entry });
    if (isSource(entry)) return makeStaticCell({ kind: 'source', source: entry });
    if (is.class(entry)) {
        const { proxy, reads } = trackReads(prev);
        return makeProducedCell(
            classifyResult(new (entry as new (p: unknown) => unknown)(proxy)),
            reads,
            undefined,
        );
    }
    if (is.function(entry)) {
        const equals = isDataLoad(entry)
            ? (entry.dataOptions.equals as EqualsFn | undefined)
            : undefined;
        const { proxy, reads } = trackReads(prev);
        return makeProducedCell(
            classifyResult((entry as (p: unknown) => unknown)(proxy)),
            reads,
            equals,
        );
    }
    return makeStaticCell({ kind: 'value', value: entry });
}

// Classify the *result* of a function/class/hook load (already called).
function classifyResult(result: unknown): CellBody {
    if (is.promise(result)) return { kind: 'promise', promise: result };
    if (isSource(result)) return { kind: 'source', source: result };
    return { kind: 'value', value: result };
}

// ---------------------------------------------------------------------------------------

// Shared, render-stable inputs threaded down the Step tree.
export type Shared = {
    scope: Scope;
    component: ComponentType<any>;
    channel: Context<unknown>;
    loading: ComponentType<{ inputs: unknown }>;
    inputs: unknown;
    // Per-level data-cell caches, held on the mandala's committed ref (see Bucket).
    buckets: Bucket[];
    // Live view of the mandala's committed cache — lets a Step's teardown tell a source
    // swap (its bucket is still current) from a stale run (remount/unmount).
    currentBuckets: () => Bucket[] | null;
    // The instance's refresh controller (undefined on the server — nothing refreshes).
    controller: RefreshController | undefined;
    // Server only: record a resolved promise value for dehydration. Undefined on client.
    collect: ((key: string, value: unknown, kind: 'value' | 'seed') => void) | undefined;
    // Server only: record a promise load that rejected during the collected render, so
    // the server can derive a response status (not-available → 404) — the render itself
    // degrades to the loading slot + React's client-retry marker without rati's help.
    collectError: ((key: string, error: SourceError) => void) | undefined;
    // Client only: server-resolved promise values to rehydrate from (scope key -> value).
    hydration: Record<string, unknown> | undefined;
    // Client only: server-dehydrated live-source seeds (scope key -> hydrate() input).
    seeds: Record<string, unknown> | undefined;
};

// Build one cell — the hydration short-circuit, the live-source seeding, and the
// server-side promotion of SSR-marked sources to the promise path all live here.
function buildCell(
    level: Scope['definition'],
    key: string,
    prev: Record<string, unknown>,
    shared: Shared,
): Cell {
    // A value dehydrated from the server short-circuits the entry: skip the load (no
    // re-fetch) and `use()` (no re-suspend), so hydration renders the server HTML
    // synchronously. Promise loads and loader sources (`ssr: true`) land here — for the
    // latter the producer never runs client-side either: promise semantics end to end.
    if (shared.hydration && key in shared.hydration) {
        const entry = level[key];
        return {
            kind: 'value',
            value: shared.hydration[key],
            // The producer didn't run, so there's no read-set yet; a direct
            // refresh(key) can still re-run it (and records the reads then).
            reads: null,
            rerunnable: is.function(entry) || is.class(entry),
            equals: isDataLoad(entry) ? (entry.dataOptions.equals as EqualsFn) : undefined,
            dirty: false,
            refreshing: null,
            lastValue: undefined,
            hasValue: false,
        };
    }

    const cell = classifyEntry(level[key], prev, key);

    // A live-source seed: feed the server value to the freshly created source before
    // anything reads or attaches it, so its first snapshot is already ready — no
    // pending gap, no double fetch, fully live afterward.
    if (shared.seeds && key in shared.seeds) {
        if (cell.kind === 'source' && cell.source.ssr && cell.source.ssr !== true) {
            try {
                cell.source.ssr.hydrate(shared.seeds[key]);
            } catch (error) {
                console.error(`[rati] hydration seed for '${key}' failed to apply`, error);
            }
        } else {
            console.warn(
                `[rati] hydration seed for '${key}' does not match a seedable live source; ignoring.`,
            );
        }
    }

    // Server + `ssr` marker: resolve the source through React's own wait mechanics —
    // its first settle wrapped into a promise (attached during render, which is what
    // the marker authorizes). Dehydrates as a plain value for a loader (`ssr: true`),
    // or through `dehydrate` as a seed for a live source. Gated on the collector: a
    // prerender without a HydrationProvider couldn't carry the value over, and a
    // server-resolved-but-unhydratable source would mismatch on the client.
    if (cell.kind === 'source' && shared.collect && cell.source.ssr) {
        const ssr = cell.source.ssr;
        return {
            ...cell,
            kind: 'promise',
            promise: firstSettle(cell.source),
            dehydrate:
                ssr !== true && ssr.dehydrate
                    ? (ssr.dehydrate as (value: unknown) => unknown)
                    : undefined,
            collectAs: ssr === true ? 'value' : 'seed',
        };
    }

    return cell;
}

// Render-time halves of a selective refresh: re-run dirty cells against the current
// `prev` (fresh upstream values — including values a cascade swapped in this very
// pass, since levels render top-down). A promise re-run keeps the old value rendered
// and settles through the controller; a sync value re-run gates and swaps here; a
// source re-run swaps the source (new `sources` identity re-keys the Step's effects).
function processDirtyCells(
    level: Scope['definition'],
    dataKeys: string[],
    bucket: Bucket,
    prev: Record<string, unknown>,
    index: number,
    controller: RefreshController,
): void {
    for (const key of dataKeys) {
        const cell = bucket.cells.get(key);
        if (!cell?.dirty) continue;
        cell.dirty = false;
        if (!cell.rerunnable) continue;

        const next = classifyEntry(level[key], prev, key);
        cell.reads = next.reads;

        if (next.kind === 'promise') {
            const token = controller.nextToken();
            cell.refreshing = { token };
            controller.trackRefresh(index, key, next.promise, token);
            continue;
        }

        // The producer stopped yielding a source — the old one leaves the bucket (the
        // detach effect releases entries the current array no longer holds).
        if (cell.kind === 'source' && next.kind !== 'source') {
            bucket.sources = bucket.sources.filter((entry) => entry.source !== cell.source);
        }

        if (next.kind === 'value') {
            const equals = cell.equals ?? deepEqual;
            if (!(cell.hasValue && equals(cell.lastValue, next.value))) {
                bucket.cells.set(key, {
                    ...next,
                    equals: cell.equals,
                    lastValue: cell.lastValue,
                    hasValue: cell.hasValue,
                });
                controller.valueChanged(index, key);
            }
            controller.syncSettled(key);
        } else {
            // Source swap: keep the pre-swap value rendered until the new source's
            // first ready (`swapped`), and re-key the level's source machinery.
            const swapped: Cell = {
                ...next,
                equals: cell.equals,
                lastValue: cell.lastValue,
                hasValue: cell.hasValue,
                swapped: true,
            };
            bucket.cells.set(key, swapped);
            bucket.sources = bucket.sources
                .filter((entry) => !(cell.kind === 'source' && entry.source === cell.source))
                .concat({ source: next.source, detach: null });
            controller.sourceSwapped(key);
        }
    }
}

// Rejection recording attaches once per promise: a suspended level re-renders on
// resume and its cached cell (same promise identity) passes through here again —
// without the guard every pass would stack another handler.
const recordedRejections = new WeakSet<Promise<unknown>>();

type StepProps = {
    level: Scope['definition'];
    index: number;
    hookKeys: string[];
    dataKeys: string[];
    prev: Record<string, unknown>;
    shared: Shared;
    children: (resolved: Record<string, unknown>) => ReactNode;
};

/*
    One level of the waterfall. Hook loads run every render in stable order (never
    cached); data loads are built once for this mount (cached identity, so a promise
    handed to `use()` / a source handed to the reactive read stay stable across the
    source-transition re-renders), and attached/detached in an effect. The hooks pass
    runs before any `use()` so an early `<Loading/>` return is hook-order safe.
*/
function Step({ level, index, hookKeys, dataKeys, prev, shared, children }: StepProps) {
    // Data cells for this level, built once into the mandala-held bucket (survives a
    // `use()` suspension). The inner tree remounts on a param change, so `prev` is
    // stable for a Step's lifetime and the bucket is fresh per mount.
    const bucket = shared.buckets[index]!;
    if (!bucket.built) {
        for (const key of dataKeys) {
            const cell = buildCell(level, key, prev, shared);
            if (cell.kind === 'source') bucket.sources.push({ source: cell.source, detach: null });
            bucket.cells.set(key, cell);
        }
        bucket.built = true;
    } else if (shared.controller) {
        processDirtyCells(level, dataKeys, bucket, prev, index, shared.controller);
    }
    const dataCells = bucket.cells;
    const sources = bucket.sources;

    // Attach (layout) and detach (passive) are split across two effects on purpose.
    //
    // ATTACH in a *layout* effect so a synchronously-ready source (an already-cached
    // resource) flips ready before the browser paints: the attach runs in the commit's
    // layout phase, its reactive read re-renders the Step before paint, and the loading
    // slot below — though rendered for one pass — is replaced with content in the same
    // frame (no visible flash). A passive attach ran after paint, so even cached data
    // showed the loading slot for a frame. A genuinely pending source still renders the
    // loading slot (its state stays pending after attach); only the wasted cached-data
    // frame is removed.
    //
    // DETACH in a *passive* effect's cleanup so it stays ordered after the leaf's
    // `.provide()` dispose, which is a layout cleanup: React flushes every layout
    // cleanup before any passive cleanup, so the provided value (built over these
    // grabbed sources) is disposed while the sources are still attached — the
    // load-bearing dispose-before-detach order. (Keeping detach in the layout effect's
    // own cleanup would make it a layout cleanup too, and layout cleanups run
    // parent-first, so this level's detach would run before the deeper leaf's dispose —
    // the exact inversion this split avoids.)
    useLayoutEffect(() => {
        if (sources.length && navTraceEnabled()) {
            navTrace(`level ${index} source attach (pre-paint) [${dataKeys.join(',')}]`);
        }
        for (const entry of sources) if (!entry.detach) entry.detach = entry.source.attach();
    }, [sources]);

    useEffect(() => {
        return () => {
            // A source swap replaces the array ([sources] re-keys this effect): the
            // swap's leavers detach here, but entries the live bucket still holds must
            // stay attached. A stale bucket (inner-tree remount) detaches everything;
            // plain unmount leaves the live entries to the mandala's sweep (a cleanup
            // can't tell deps-change from unmount).
            const currentBuckets = shared.currentBuckets();
            const bucketIsLive = currentBuckets?.[index] === bucket;
            for (let i = sources.length - 1; i >= 0; i--) {
                const entry = sources[i]!;
                if (bucketIsLive && bucket.sources.includes(entry)) continue;
                if (entry.detach) {
                    try {
                        entry.detach();
                    } catch (error) {
                        console.error('Source detach failed', error);
                    }
                    entry.detach = null;
                }
            }
        };
    }, [sources]);

    // Re-render this level when any of its data sources transitions. One uSES per Step
    // subscribes to all the level's sources at once (the array identity changes only on
    // a source swap, which re-keys the subscription). The snapshot is the array of
    // source states, rebuilt only when one changes identity — so it stays referentially
    // stable between transitions (uSES requires that). Sources only emit from
    // `attach()` (the effect above), so the subscription is live before any transition.
    // Hook sources aren't here: a hook owns its own subscription (it runs every render
    // and may call its own hooks).
    const sourceStore = useMemo(() => {
        let snapshot = sources.map((entry) => entry.source.getSnapshot());
        const changed = () => {
            for (let i = 0; i < sources.length; i++) {
                if (sources[i]!.source.getSnapshot() !== snapshot[i]) return true;
            }
            return false;
        };
        return {
            subscribe(onChange: () => void) {
                const unsubs = sources.map((entry) => entry.source.subscribe(onChange));
                return () => {
                    for (const unsub of unsubs) unsub();
                };
            },
            getSnapshot(): readonly SourceState<unknown>[] {
                if (changed()) snapshot = sources.map((entry) => entry.source.getSnapshot());
                return snapshot;
            },
        };
    }, [sources]);
    useSyncExternalStore(sourceStore.subscribe, sourceStore.getSnapshot, sourceStore.getSnapshot);

    // Hook loads first (every render, stable order — they may call React hooks), then
    // the cached data cells. `use()` in the resolve pass below is loop/early-return
    // safe, so the hook-call sequence is identical every render.
    const cells: [string, Cell | CellBody][] = [];
    for (const key of hookKeys) {
        cells.push([key, classifyResult((level[key] as HookLoad)(prev))]);
    }
    for (const key of dataKeys) cells.push([key, dataCells.get(key)!]);

    const resolved: Record<string, unknown> = { ...prev };
    let pending = false;
    for (const [key, cell] of cells) {
        if (cell.kind === 'value') {
            resolved[key] = cell.value;
        } else if (cell.kind === 'promise') {
            if (shared.collectError && !recordedRejections.has(cell.promise)) {
                recordedRejections.add(cell.promise);
                const collectError = shared.collectError;
                void cell.promise.then(undefined, (thrown: unknown) => {
                    collectError(key, asSourceError(thrown));
                });
            }
            const value = use(cell.promise);
            // Render-time write, but only on the server (client has no `collect`) and
            // idempotent per key — the established SSR data-collection pattern. A
            // live-source cell ships `dehydrate(value)` as a seed instead of the value.
            if (shared.collect) {
                const cellDehydrate = 'dehydrate' in cell ? cell.dehydrate : undefined;
                shared.collect(
                    key,
                    cellDehydrate ? cellDehydrate(value) : value,
                    ('collectAs' in cell ? cell.collectAs : undefined) ?? 'value',
                );
            }
            resolved[key] = value;
        } else {
            const state = cell.source.getSnapshot();
            if (state.status === 'error') throw state.error;
            if (state.status === 'pending') {
                // A cascade-swapped source still warming up keeps the pre-swap value
                // rendered instead of dropping the level to the loading slot. A live
                // source that itself returns to pending still drops to loading — that
                // behavior is the source's own contract, unchanged.
                if ('swapped' in cell && cell.swapped && cell.hasValue) {
                    resolved[key] = cell.lastValue;
                } else {
                    pending = true;
                }
            } else {
                if ('swapped' in cell && cell.swapped) {
                    cell.swapped = false;
                    shared.controller?.sourceReady(key);
                }
                resolved[key] = state.value;
            }
        }
        // Remember what this pass handed down — the stale baseline a refresh renders
        // while re-fetching and the old side of its equals gate.
        if ('rerunnable' in cell && key in resolved) {
            cell.lastValue = resolved[key];
            cell.hasValue = true;
        }
    }

    if (pending) {
        if (navTraceEnabled()) navTrace(`level ${index} render loading slot (pending)`);
        const Loading = shared.loading;
        return <Loading inputs={shared.inputs} />;
    }
    return children(resolved);
}

// The waterfall's tail: provide the value to the subtree (the resolved props by
// default, or the `.provide()` value) and render the component. A `.provide()` value
// is built in an effect (its factory has side effects) and disposed on unmount —
// before the sources it was built over detach (see Step's effect comment).
type LeafProps = { resolved: Record<string, unknown>; shared: Shared };

function Leaf({ resolved, shared }: LeafProps) {
    const provideDef = shared.scope.provideDef;
    const Component = shared.component;
    const channel = shared.channel;

    if (!provideDef) {
        // Provide-by-default: publish the resolved props to the subtree (useScope).
        return (
            <channel.Provider value={resolved}>
                <Component {...resolved} />
            </channel.Provider>
        );
    }
    return (
        <ProvideLeaf
            provideDef={provideDef}
            resolved={resolved}
            component={Component}
            channel={channel}
            loading={shared.loading}
            inputs={shared.inputs}
            cacheToken={shared.buckets}
            controller={shared.controller}
        />
    );
}

type ProvideLeafProps = {
    provideDef: ScopeProvideDef;
    resolved: Record<string, unknown>;
    component: ComponentType<any>;
    channel: Context<unknown>;
    loading: ComponentType<{ inputs: unknown }>;
    inputs: unknown;
    // The mandala's bucket array — a new identity whenever the cache is rebuilt (param
    // change / StrictMode remount), and stable across plain re-renders + live source
    // updates. Used as the rebuild key so the provided value tracks the surviving run
    // without deep-comparing `resolved` (which holds live store instances).
    cacheToken: unknown;
    controller: RefreshController | undefined;
};

function ProvideLeaf({
    provideDef,
    resolved,
    component: Component,
    channel,
    loading: Loading,
    inputs,
    cacheToken,
    controller,
}: ProvideLeafProps) {
    const [built, setBuilt] = useState<{ value: unknown } | null>(null);
    // Bumped when a selective refresh changes a key the factory consumed — the effect
    // below re-keys, so the stale value disposes and a fresh one builds.
    const [version, bumpVersion] = useReducer((count: number) => count + 1, 0);
    const readsRef = useRef<ReadonlySet<string> | null>(null);

    // Build the value, dispose it on teardown / rebuild. A *layout* effect so that, on
    // unmount, this dispose runs in the commit's layout phase — before the *passive*
    // effect that detaches the sources it was built over (React flushes all layout
    // cleanups before any passive cleanup). That's the load-bearing dispose-before-detach
    // order. Keyed by `cacheToken`: rebuilds for a new run (param change / StrictMode
    // remount), not on per-render churn — plus `version` for selective refresh.
    // `resolved` is read from the rebuild render.
    useLayoutEffect(() => {
        navTrace('leaf .provide() built — component renders next');
        const { proxy, reads } = trackReads(resolved);
        const value = provideDef.factory(proxy);
        readsRef.current = reads;
        setBuilt({ value });
        return () => {
            const dispose = (value as Partial<Disposable> | undefined)?.[Symbol.dispose];
            if (typeof dispose === 'function') {
                try {
                    dispose.call(value);
                } catch (error) {
                    console.error('Provided value dispose failed', error);
                }
            }
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by cacheToken + version
    }, [cacheToken, version]);

    useEffect(() => {
        if (!controller) return undefined;
        return controller.subscribeChanged((key) => {
            if (readsRef.current?.has(key)) bumpVersion();
        });
    }, [controller]);

    if (!built) return <Loading inputs={inputs} />;

    let content: ReactNode = (
        <channel.Provider value={built.value}>
            <Component {...resolved} />
        </channel.Provider>
    );
    if (provideDef.channel) {
        const AppProvider = provideDef.channel.Provider;
        content = <AppProvider value={built.value}>{content}</AppProvider>;
    }
    return content;
}

// Build the nested Step tree from the scope's levels: each level is a Step that
// renders the next once ready; the innermost renders the Leaf.
export function buildTree(
    levels: Scope['definition'][],
    index: number,
    prev: Record<string, unknown>,
    shared: Shared,
): ReactNode {
    if (index >= levels.length) return <Leaf resolved={prev} shared={shared} />;
    const level = levels[index]!;
    const { hookKeys, dataKeys } = partition(level);
    return (
        <Step
            level={level}
            index={index}
            hookKeys={hookKeys}
            dataKeys={dataKeys}
            prev={prev}
            shared={shared}
        >
            {(resolved) => buildTree(levels, index + 1, resolved, shared)}
        </Step>
    );
}

// Bucket re-export: the model moved to refresh.ts with the controller; mandala.tsx and
// the tests import it from here, the resolver's home turf.
export type { Bucket } from './refresh';
