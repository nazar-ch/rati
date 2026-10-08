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
    bucketSignal,
    makeProducedCell,
    makeStaticCell,
    trackReads,
    type Bucket,
    type Cell,
    type CellBody,
    type EqualsFn,
    type ProducedBody,
    type ProducedCell,
    type RefreshController,
} from './refresh.js';
import { SsrRejection } from './ssrErrors.js';
import { firstSettle } from './ssrSource.js';

import {
    isDataLoad,
    isHookLoad,
    InputSymbol,
    type HookLoad,
    type LoadContext,
    type Scope,
    type ScopeProvideDef,
} from '../scope/scope.js';
import { asSourceError, isSource, type SourceError, type SourceState } from '../scope/source.js';
import {
    errorLabel,
    traceCellPromise,
    traceCellRefresh,
    traceCellStatus,
    traceLevelStart,
    traceResolved,
    type DataTrace,
} from '../util/dataTrace.js';
import { navTrace, navTraceEnabled } from '../util/navTrace.js';
import { is, deepEqual } from '../util/utils.js';

/*
    The mandala's resolution mechanics: a scope's levels compile into nested `Step` components,
    one per level, and React is the resolver. The design is docs/current/internals.md.
*/

// Flatten the scope's prevScope links into ordered levels (level 0 first).
export function flattenLevels(scope: Scope): Scope['definition'][] {
    const levels: Scope['definition'][] = [];
    for (let current: Scope | undefined = scope; current; current = current.prevScope) {
        levels.unshift(current.definition);
    }
    return levels;
}

// What a level compiles to, memoized once per frozen level object: the hook/data key split —
// `hook()` loads run every render, every other entry is a cached data load — and the level's
// own `Step`, named for its keys.
type CompiledLevel = {
    keys: string[];
    hookKeys: string[];
    dataKeys: string[];
    LevelStep: typeof Step;
};
const levelCache = new WeakMap<object, CompiledLevel>();
function compileLevel(level: Scope['definition']): CompiledLevel {
    let compiled = levelCache.get(level);
    if (!compiled) {
        const keys = Object.keys(level);
        const hookKeys: string[] = [];
        const dataKeys: string[] = [];
        for (const key of keys) {
            if (isHookLoad(level[key])) hookKeys.push(key);
            else dataKeys.push(key);
        }
        compiled = { keys, hookKeys, dataKeys, LevelStep: namedStep(keys) };
        levelCache.set(level, compiled);
    }
    return compiled;
}

// A per-level alias of `Step` whose displayName is the level's keys, for DevTools
// (`Island(Prefs) → Step(user,prefs)`). A bound copy, never a wrapper: no extra fiber, and
// memoized on the frozen level, so its identity is stable. A level object is shared across
// mandalas, so it carries no island label.
function namedStep(keys: string[]): typeof Step {
    const named = Step.bind(null) as typeof Step & { displayName?: string };
    const label = keys.join(',');
    // Bare `Step` for the empty level — the inputs head of an input-less scope.
    named.displayName = !label
        ? 'Step'
        : `Step(${label.length > 48 ? `${label.slice(0, 47)}…` : label})`;
    return named;
}

// Classifies a data entry into a cell. Function and class producers run against a
// read-tracking proxy of the prior levels' values, the read-set a selective refresh cascades
// along; a function load also gets the level's `LoadContext`, and a class load owns what it
// starts.
function classifyEntry(
    entry: unknown,
    prev: Record<string, unknown>,
    key: string,
    context: LoadContext,
): ProducedCell {
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
            classifyResult((entry as (p: unknown, c: LoadContext) => unknown)(proxy, context)),
            reads,
            equals,
        );
    }
    return makeStaticCell({ kind: 'value', value: entry });
}

// Classify the result of a function/class/hook load (already called).
function classifyResult(result: unknown): ProducedBody {
    if (is.promise(result)) return { kind: 'promise', promise: result };
    if (isSource(result)) return { kind: 'source', source: result };
    return { kind: 'value', value: result };
}

// Shared, render-stable inputs threaded down the Step tree.
export type Shared = {
    scope: Scope;
    component: ComponentType<any>;
    channel: Context<unknown>;
    // What the island shows while it has no fresh content: the loading slot, the kept run
    // (`keepStale`), or nothing while `loadingDelayMs` holds it back, reporting its own
    // phase. One element for the three sites that can show it (docs/current/internals.md).
    slot: ReactNode;
    // Per-level data-cell caches, held on the mandala's committed ref (see Bucket).
    buckets: Bucket[];
    // Does the mandala still own this bucket? True for the run being rendered and for the
    // one `keepStale` is holding on screen — which is what lets a Step's teardown tell a
    // source swap (or a kept run) from a discarded one (remount/unmount).
    bucketRetained: (index: number, bucket: Bucket) => boolean;
    // The instance's refresh controller (undefined on the server — nothing refreshes).
    controller: RefreshController | undefined;
    // This run's data-trace timeline (the `rati/debug` entry), undefined unless tracing is
    // on — which is the only state that costs anything: every hook below hands it straight
    // back to util/dataTrace.ts, which returns on the spot.
    trace: DataTrace | undefined;
    // Server only: record a resolved promise value for dehydration. Undefined on client.
    collect: ((key: string, value: unknown, kind: 'value' | 'seed') => void) | undefined;
    // Server only: record a promise load that rejected during the collected render, so
    // the server can derive a response status (not-available → 404) — the render itself
    // degrades to the loading slot + React's client-retry marker without rati's help.
    collectError: ((key: string, error: SourceError) => void) | undefined;
    // The promises this run has already handed to `collectError` (see recordRejection).
    // Lives on the run, next to the collector it feeds — present exactly when that is.
    recordedRejections: WeakSet<Promise<unknown>> | undefined;
    // Server with `ssrErrors: 'dehydrate'` only. React runs no error boundary during a server
    // render, so this is the resolver's own error path: `guard` hands back a promise that
    // cannot reject (ssrErrors.ts), and `slot` builds the island's error slot, null when it
    // declares none.
    ssrErrors:
        | {
              guard: (promise: Promise<unknown>) => Promise<unknown>;
              slot: ((error: SourceError) => ReactNode) | null;
          }
        | undefined;
    // Client only, diagnostic: notes a hydration/seed slice as consumed, feeding the
    // unclaimed-payload watchdog (hydrationDiagnostics.ts).
    claim: ((key: string, section: 'data' | 'seeds' | 'errors') => void) | undefined;
    // Client only: server-resolved promise values to rehydrate from (scope key -> value).
    hydration: Record<string, unknown> | undefined;
    // Client only: server-dehydrated live-source seeds (scope key -> hydrate() input).
    seeds: Record<string, unknown> | undefined;
    // Client only: loads that failed during the server render and were carried over
    // (scope key -> SourceError) — the `ssrErrors` field above, seen from the other side.
    errors: Record<string, SourceError> | undefined;
    // Kept-run options only, i.e. `keepStale` / `loadingDelayMs` (undefined otherwise). The
    // leaf reports what it committed, which becomes the baseline the next re-resolve keeps
    // on screen — and the report is the swap: recording the new output is what releases the
    // run it replaces.
    commit:
        | ((
              buckets: Bucket[],
              resolved: Record<string, unknown>,
              provided: { value: unknown } | null,
          ) => void)
        | undefined;
    // Same. Called from the leaf's passive effect once its run is on screen — the moment the
    // run it replaced can be let go (see the mandala's swapRun).
    swap: ((buckets: Bucket[]) => void) | undefined;
    // Same. A retiring `ProvideLeaf` offers its dispose here; taken (true) when its run is
    // the kept one, so the value stays alive while it is still being published.
    retainProvided: ((buckets: Bucket[], dispose: () => void) => boolean) | undefined;
};

// Build one cell — the hydration short-circuit, the live-source seeding, and the
// server-side promotion of SSR-marked sources to the promise path all live here.
function buildCell(
    level: Scope['definition'],
    key: string,
    prev: Record<string, unknown>,
    shared: Shared,
    context: LoadContext,
): Cell {
    // A value dehydrated from the server short-circuits the entry, skipping the load and
    // `use()`, so hydration renders the server HTML synchronously. Promise loads and loader
    // sources (`ssr: true`) land here, and a loader's producer never runs client-side.
    if (shared.hydration && key in shared.hydration) {
        const entry = level[key];
        shared.claim?.(key, 'data');
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

    // ...and a failure dehydrated from the server (`ssrErrors: 'dehydrate'`) short-circuits it
    // to the error state: the resolve pass throws it to the boundary, and the server's error
    // slot stays with `retry` armed, the load never running here.
    if (shared.errors && key in shared.errors) {
        shared.claim?.(key, 'errors');
        return makeStaticCell({ kind: 'error', error: shared.errors[key]! });
    }

    const cell = classifyEntry(level[key], prev, key, context);

    // A live-source seed: feed the server value to the freshly created source before
    // anything reads or attaches it, so its first snapshot is already ready — no
    // pending gap, no double fetch, fully live afterward.
    if (shared.seeds && key in shared.seeds) {
        shared.claim?.(key, 'seeds');
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

    // Server with the `ssr` marker: the source's first settle becomes a promise, attached
    // during render as the marker authorizes. Gated on the collector: without a
    // HydrationProvider the value cannot cross, and a server-resolved source mismatches on the
    // client.
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

// Feed a freshly built (or re-run, or hook-produced) cell to the data tracer: a promise is
// timed to its own settle, a sync value settles right here, and a source settles through
// the transition read in the resolve pass below.
function traceCell(
    trace: DataTrace | undefined,
    index: number,
    key: string,
    cell: Cell | CellBody,
    detail?: string,
): void {
    if (!trace) return;
    if (cell.kind === 'promise') traceCellPromise(trace, index, key, cell.promise);
    else if (cell.kind === 'value') traceCellStatus(trace, index, key, 'ready', detail);
    else if (cell.kind === 'error') {
        traceCellStatus(trace, index, key, 'error', errorLabel(cell.error));
    }
}

// Render-time halves of a selective refresh: dirty cells re-run against the current `prev`,
// a cascade's values included. A promise re-run settles through the controller, a sync value
// gates and swaps here, and a source re-run swaps the source, re-keying the Step's effects.
function processDirtyCells(
    level: Scope['definition'],
    dataKeys: string[],
    bucket: Bucket,
    prev: Record<string, unknown>,
    index: number,
    controller: RefreshController,
    trace: DataTrace | undefined,
): void {
    for (const key of dataKeys) {
        const cell = bucket.cells.get(key);
        if (!cell?.dirty) continue;
        cell.dirty = false;
        if (!cell.rerunnable) continue;

        traceCellRefresh(trace, index, key);
        // The re-run gets the same bucket signal the first run did: a selective refresh
        // replaces a load WITHIN the run, it doesn't discard the run.
        const next = classifyEntry(level[key], prev, key, { signal: bucketSignal(bucket) });
        traceCell(trace, index, key, next);
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

// Hands a rejecting promise load to the render's error collector once per promise per RUN: a
// suspended level re-renders on resume with the same cached promise, and a module-global
// ledger silences a second render reusing that promise.
function recordRejection(shared: Shared, key: string, promise: Promise<unknown>): void {
    const { collectError, recordedRejections } = shared;
    if (!collectError || !recordedRejections || recordedRejections.has(promise)) return;
    recordedRejections.add(promise);
    void promise.then(undefined, (thrown: unknown) => {
        collectError(key, asSourceError(thrown));
    });
}

type StepProps = {
    level: Scope['definition'];
    index: number;
    keys: string[];
    hookKeys: string[];
    dataKeys: string[];
    prev: Record<string, unknown>;
    shared: Shared;
    children: (resolved: Record<string, unknown>) => ReactNode;
};

/*
    One level of the waterfall. Hook loads run every render in stable order, before any
    `use()`, so an early `<Loading/>` return is hook-order safe; data loads are built once per
    mount, with stable identity, and attached in an effect.
*/
function Step({ level, index, keys, hookKeys, dataKeys, prev, shared, children }: StepProps) {
    // Data cells for this level, built once into the mandala-held bucket (survives a
    // `use()` suspension). The inner tree remounts on a param change, so `prev` is
    // stable for a Step's lifetime and the bucket is fresh per mount.
    const bucket = shared.buckets[index]!;
    const trace = shared.trace;
    if (!bucket.built) {
        traceLevelStart(trace, index, keys);
        // What this level's function loads receive as their second argument — one bag
        // for the level, carrying the BUCKET'S signal: cancellation lives with the run,
        // not with the individual load (see bucketSignal).
        const context: LoadContext = { signal: bucketSignal(bucket) };
        for (const key of dataKeys) {
            const cell = buildCell(level, key, prev, shared, context);
            if (trace) {
                const entry = level[key];
                // Inputs arrive with the run — they are not loads, so they get no settle
                // line. A dehydrated cell does, marked: it lands ready in zero time
                // because the server already ran the load.
                const isInput = is.object(entry) && InputSymbol in entry;
                const hydrated = shared.hydration ? key in shared.hydration : false;
                if (!isInput) {
                    traceCell(trace, index, key, cell, hydrated ? '(hydrated)' : undefined);
                }
            }
            if (cell.kind === 'source') bucket.sources.push({ source: cell.source, detach: null });
            bucket.cells.set(key, cell);
        }
        bucket.built = true;
    } else if (shared.controller) {
        processDirtyCells(level, dataKeys, bucket, prev, index, shared.controller, trace);
    }
    const dataCells = bucket.cells;
    const sources = bucket.sources;

    // ATTACH in a LAYOUT effect, so a synchronously-ready source flips to content before paint.
    // DETACH in a PASSIVE cleanup, which React flushes after every layout cleanup, so the leaf's
    // `.provide()` dispose runs while the sources are still attached (docs/current/internals.md).
    useLayoutEffect(() => {
        if (sources.length && navTraceEnabled()) {
            navTrace(`level ${index} source attach (pre-paint) [${dataKeys.join(',')}]`);
        }
        for (const entry of sources) if (!entry.detach) entry.detach = entry.source.attach();
    }, [sources]);

    useEffect(() => {
        return () => {
            // A source swap re-keys this effect: its leavers detach here, and entries the live
            // bucket holds stay. A stale bucket detaches everything; an unmount leaves the live
            // entries to the mandala's sweep, and a kept run counts as live.
            const bucketIsLive = shared.bucketRetained(index, bucket);
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

    // One uSES per Step subscribes to the level's sources, re-keyed when a swap replaces the
    // array; the snapshot is the array of source states, rebuilt only on a change, as uSES
    // requires. Hook sources own their subscription.
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
        const cell = classifyResult((level[key] as HookLoad)(prev));
        traceCell(trace, index, key, cell);
        cells.push([key, cell]);
    }
    for (const key of dataKeys) cells.push([key, dataCells.get(key)!]);

    const resolved: Record<string, unknown> = { ...prev };
    let pending = false;
    for (const [key, cell] of cells) {
        if (cell.kind === 'value') {
            resolved[key] = cell.value;
        } else if (cell.kind === 'promise') {
            recordRejection(shared, key, cell.promise);
            // Server + `ssrErrors: 'dehydrate'`: wait on the rejection-proof twin instead,
            // so a failed load comes back as a value this pass can act on rather than a
            // throw with no boundary to catch it. The original still rejects, and the line
            // above is still what records it.
            const ssrErrors = shared.ssrErrors;
            const value = use(ssrErrors ? ssrErrors.guard(cell.promise) : cell.promise);
            if (ssrErrors && value instanceof SsrRejection) {
                // Renders the island's error slot here, the deterministic first paint this mode
                // exists for. With no slot the throw takes the default path: React degrades the
                // boundary to the loading slot.
                if (!ssrErrors.slot) throw value.error;
                return ssrErrors.slot(value.error);
            }
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
        } else if (cell.kind === 'error') {
            // A failure the server already had (`ssrErrors: 'dehydrate'`), hydrating into
            // the state a source that failed would be in — so it leaves the same way: to
            // the boundary, and the error slot the HTML is already showing.
            throw cell.error;
        } else {
            const state = cell.source.getSnapshot();
            traceCellStatus(
                trace,
                index,
                key,
                state.status,
                state.status === 'error' ? errorLabel(state.error) : undefined,
            );
            if (state.status === 'error') {
                // A swap ending in error settles it the way a first ready would: the key
                // leaves `pending` before the throw hands the tree to the boundary.
                if ('swapped' in cell && cell.swapped) {
                    cell.swapped = false;
                    shared.controller?.sourceErrored(key);
                }
                throw state.error;
            }
            if (state.status === 'pending') {
                // A cascade-swapped source still warming up keeps the pre-swap value
                // rendered instead of dropping the level to the loading slot. A live
                // source that itself returns to pending still drops to loading — the source's
                // own contract.
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
                // A source's value moving reaches the loads that read it, as a promise settle
                // does. Gated on `hasValue`, so a FIRST ready cascades nothing — the waterfall
                // feeds the levels below on its way down — and through the equals gate, so a
                // pending/ready blip onto the old value moves nothing.
                if ('rerunnable' in cell && cell.hasValue) {
                    const equals = cell.equals ?? deepEqual;
                    if (!equals(cell.lastValue, state.value)) {
                        shared.controller?.valueChanged(index, key);
                    }
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
        // The mandala's one slot element — so a level pending on a source and a level
        // suspended on a promise look the same from outside, kept content and delayed slot
        // included. Whatever it turns out to be reports its own phase.
        return shared.slot;
    }
    return children(resolved);
}

// The waterfall's tail: provides the resolved props or the `.provide()` value to the subtree
// and renders the component. A `.provide()` value is built in an effect, its factory having
// side effects, and disposed before the sources it was built over detach.
type LeafProps = { resolved: Record<string, unknown>; shared: Shared };

function Leaf({ resolved, shared }: LeafProps) {
    // Reaching the leaf is the run's finish line — the waterfall's total lands here.
    traceResolved(shared.trace);
    // ...and the island is showing content. A `.provide()` scope is not there yet — its
    // value still has to build — so ProvideLeaf reports for itself.
    if (!shared.scope.provideDef) shared.controller?.reportPhase('ready', false);
    const provideDef = shared.scope.provideDef;
    const Component = shared.component;
    const channel = shared.channel;

    // Provide-by-default: this render IS the output, so the commit is the whole story
    // (a `.provide()` scope waits for its value — see ProvideLeaf). A layout effect, so
    // the baseline `keepStale` keeps is one that actually reached the screen.
    const commit = shared.commit;
    const swap = shared.swap;
    const buckets = shared.buckets;
    useLayoutEffect(() => {
        if (!provideDef) commit?.(buckets, resolved, null);
    });
    useEffect(() => {
        if (!provideDef) swap?.(buckets);
    });

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
            slot={shared.slot}
            cacheToken={shared.buckets}
            controller={shared.controller}
            commit={commit}
            swap={swap}
            retainProvided={shared.retainProvided}
        />
    );
}

type ProvideLeafProps = {
    provideDef: ScopeProvideDef;
    resolved: Record<string, unknown>;
    component: ComponentType<any>;
    channel: Context<unknown>;
    slot: ReactNode;
    commit: Shared['commit'];
    swap: Shared['swap'];
    retainProvided: Shared['retainProvided'];
    // The mandala's bucket array, a new identity only when the cache is rebuilt — the rebuild
    // key, so the provided value tracks the surviving run without deep-comparing `resolved`,
    // which holds live store instances.
    cacheToken: unknown;
    controller: RefreshController | undefined;
};

function ProvideLeaf({
    provideDef,
    resolved,
    component: Component,
    channel,
    slot,
    cacheToken,
    controller,
    commit,
    swap,
    retainProvided,
}: ProvideLeafProps) {
    const [built, setBuilt] = useState<{ value: unknown } | null>(null);
    // Bumped when a selective refresh changes a key the factory consumed — the effect
    // below re-keys, so the stale value disposes and a fresh one builds.
    const [version, bumpVersion] = useReducer((count: number) => count + 1, 0);
    const readsRef = useRef<ReadonlySet<string> | null>(null);

    // Builds the value and disposes it on teardown or rebuild, in a LAYOUT effect: its unmount
    // dispose runs before the PASSIVE detach of the sources it was built over. Keyed by
    // `cacheToken` (a new run) and `version` (a selective refresh), never per-render churn.
    useLayoutEffect(() => {
        navTrace('leaf .provide() built — component renders next');
        const { proxy, reads } = trackReads(resolved);
        const value = provideDef.factory(proxy);
        readsRef.current = reads;
        setBuilt({ value });
        return () => {
            const disposeValue = () => {
                const dispose = (value as Partial<Disposable> | undefined)?.[Symbol.dispose];
                if (typeof dispose === 'function') {
                    try {
                        dispose.call(value);
                    } catch (error) {
                        console.error('Provided value dispose failed', error);
                    }
                }
            };
            // A run `keepStale` is holding on screen is still publishing this value, so the
            // mandala takes the dispose and runs it at the swap — before it detaches the
            // sources the value was built over, which is the order that matters. Everything
            // else (a rebuild, a discarded run, unmount) disposes right here.
            if (retainProvided?.(cacheToken as Bucket[], disposeValue)) return;
            disposeValue();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by cacheToken + version
    }, [cacheToken, version]);

    useEffect(() => {
        if (!controller) return undefined;
        return controller.subscribeChanged((key) => {
            if (readsRef.current?.has(key)) bumpVersion();
        });
    }, [controller]);

    // The output of a `.provide()` run is its props AND the value it publishes, so the
    // commit waits for the build above — which is also why it can't ride the same effect.
    useLayoutEffect(() => {
        if (built) commit?.(cacheToken as Bucket[], resolved, { value: built.value });
    });
    useEffect(() => {
        if (built) swap?.(cacheToken as Bucket[]);
    });

    // The build frame: one render with the value not yet made — the island's third
    // not-ready instant, and it shows the same slot as the other two.
    if (!built) return slot;
    controller?.reportPhase('ready', false);

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
    const { keys, hookKeys, dataKeys, LevelStep } = compileLevel(level);
    return (
        <LevelStep
            level={level}
            index={index}
            keys={keys}
            hookKeys={hookKeys}
            dataKeys={dataKeys}
            prev={prev}
            shared={shared}
        >
            {(resolved) => buildTree(levels, index + 1, resolved, shared)}
        </LevelStep>
    );
}

// Re-exported for mandala.tsx and the tests, which import the bucket model from the resolver.
export type { Bucket } from './refresh.js';
