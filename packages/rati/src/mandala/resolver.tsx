import { observer } from 'mobx-react-lite';
import { use, useEffect, useLayoutEffect, useState } from 'react';
import type { ComponentType, Context, ReactNode } from 'react';
import {
    isHookLoad,
    ParamSymbol,
    type HookLoad,
    type Scope,
    type ScopeProvideDef,
} from '../scope/scope';
import { isSource, type Source } from '../scope/source';
import { is } from '../util/utils';
import { navTrace, navTraceEnabled } from '../util/navTrace';

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
        observably; pending renders the loading slot (no server resolution — sources
        stay pending under SSR and resolve on the client), error throws to the slot.
        A ready source returning to pending drops back to loading, live.
      - a *hook* load (`hook(fn)`) runs every render so `fn` may call any React hook;
        it's the seam that lets a level read its own deps (`use(StoresContext)`) — the
        reason `env` is gone. Its result is classified like a function load. rati never
        attaches/detaches a hook source; the hook owns its own subscription.

    Lifetime is React's: each `Step` attaches its level's *data* sources in an effect
    and detaches on unmount; a param change remounts the inner tree, so React tears the
    old one down (children first → the leaf's `.provide()` value disposes before the
    sources it was built over detach) and mounts a fresh one.
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

// One resolved cell. Props/classes/plain values resolve instantly; a function is
// called with the prior levels' ready values and its result re-classified; a promise
// is unwrapped with `use()`; a source is read observably.
type Cell =
    | { kind: 'value'; value: unknown }
    | { kind: 'promise'; promise: Promise<unknown> }
    | { kind: 'source'; source: Source<unknown> };

// Classify a *data entry* (the value written in the scope definition).
function classifyEntry(entry: unknown, prev: Record<string, unknown>, key: string): Cell {
    if (is.object(entry) && ParamSymbol in entry) return { kind: 'value', value: prev[key] };
    if (is.promise(entry)) return { kind: 'promise', promise: entry };
    if (isSource(entry)) return { kind: 'source', source: entry };
    if (is.class(entry)) return { kind: 'value', value: new entry(prev) };
    if (is.function(entry)) return classifyResult((entry as (p: unknown) => unknown)(prev));
    return { kind: 'value', value: entry };
}

// Classify the *result* of a function/hook load (already called).
function classifyResult(result: unknown): Cell {
    if (is.promise(result)) return { kind: 'promise', promise: result };
    if (isSource(result)) return { kind: 'source', source: result };
    return { kind: 'value', value: result };
}

// ---------------------------------------------------------------------------------------

type SourceEntry = { source: Source<unknown>; detach: (() => void) | null };

// One level's data cells, built once. Lives on the mandala's committed ref (not the
// Step's fiber) so it survives a `use()` suspension: a suspended render is discarded,
// which would otherwise re-build the cell — re-running its load and re-suspending on a
// brand-new promise forever. Built per level here; the load side effect runs once.
export type Bucket = { cells: Map<string, Cell>; sources: SourceEntry[]; built: boolean };

// Shared, render-stable inputs threaded down the Step tree.
export type Shared = {
    scope: Scope;
    component: ComponentType<any>;
    channel: Context<unknown>;
    loading: ComponentType<{ params: unknown }>;
    params: unknown;
    // Per-level data-cell caches, held on the mandala's committed ref (see Bucket).
    buckets: Bucket[];
    // Server only: record a resolved promise value for dehydration. Undefined on client.
    collect: ((key: string, value: unknown) => void) | undefined;
    // Client only: server-resolved promise values to rehydrate from (scope key -> value).
    hydration: Record<string, unknown> | undefined;
};

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
const Step = observer(function Step({
    level,
    index,
    hookKeys,
    dataKeys,
    prev,
    shared,
    children,
}: StepProps) {
    // Data cells for this level, built once into the mandala-held bucket (survives a
    // `use()` suspension). The inner tree remounts on a param change, so `prev` is
    // stable for a Step's lifetime and the bucket is fresh per mount.
    const bucket = shared.buckets[index]!;
    if (!bucket.built) {
        for (const key of dataKeys) {
            // A value dehydrated from the server short-circuits the entry: skip the
            // load (no re-fetch) and `use()` (no re-suspend), so hydration renders the
            // server HTML synchronously. Only promises are ever dehydrated.
            const cell =
                shared.hydration && key in shared.hydration
                    ? ({ kind: 'value', value: shared.hydration[key] } as Cell)
                    : classifyEntry(level[key], prev, key);
            if (cell.kind === 'source') bucket.sources.push({ source: cell.source, detach: null });
            bucket.cells.set(key, cell);
        }
        bucket.built = true;
    }
    const { cells: dataCells, sources } = bucket;

    // Attach this level's data sources after mount; detach on unmount. Both this and
    // the leaf's `.provide()` dispose are passive effects, so React's child-first
    // unmount runs dispose (deeper) before detach (shallower) — the load-bearing
    // dispose-before-detach order, structural now.
    useEffect(() => {
        if (sources.length && navTraceEnabled()) {
            navTrace(`level ${index} source attach (post-paint) [${dataKeys.join(',')}]`);
        }
        for (const entry of sources) if (!entry.detach) entry.detach = entry.source.attach();
        return () => {
            for (let i = sources.length - 1; i >= 0; i--) {
                const entry = sources[i]!;
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

    // Hook loads first (every render, stable order — they may call React hooks), then
    // the cached data cells. `use()` in the resolve pass below is loop/early-return
    // safe, so the hook-call sequence is identical every render.
    const cells: [string, Cell][] = [];
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
            const value = use(cell.promise);
            // Render-time write, but only on the server (client has no `collect`) and
            // idempotent per key — the established SSR data-collection pattern.
            shared.collect?.(key, value);
            resolved[key] = value;
        } else {
            const state = cell.source.state;
            if (state.status === 'error') throw state.error;
            if (state.status === 'pending') pending = true;
            else resolved[key] = state.value;
        }
    }

    if (pending) {
        if (navTraceEnabled()) navTrace(`level ${index} render loading slot (pending)`);
        const Loading = shared.loading;
        return <Loading params={shared.params} />;
    }
    return children(resolved);
});

// The waterfall's tail: provide the value to the subtree (the resolved props by
// default, or the `.provide()` value) and render the component. A `.provide()` value
// is built in an effect (its factory has side effects) and disposed on unmount —
// before the sources it was built over detach (see Step's effect comment).
type LeafProps = { resolved: Record<string, unknown>; shared: Shared };

const Leaf = observer(function Leaf({ resolved, shared }: LeafProps) {
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
            params={shared.params}
            cacheToken={shared.buckets}
        />
    );
});

type ProvideLeafProps = {
    provideDef: ScopeProvideDef;
    resolved: Record<string, unknown>;
    component: ComponentType<any>;
    channel: Context<unknown>;
    loading: ComponentType<{ params: unknown }>;
    params: unknown;
    // The mandala's bucket array — a new identity whenever the cache is rebuilt (param
    // change / StrictMode remount), and stable across plain re-renders + live source
    // updates. Used as the rebuild key so the provided value tracks the surviving run
    // without deep-comparing `resolved` (which holds live store instances).
    cacheToken: unknown;
};

function ProvideLeaf({
    provideDef,
    resolved,
    component: Component,
    channel,
    loading: Loading,
    params,
    cacheToken,
}: ProvideLeafProps) {
    const [built, setBuilt] = useState<{ value: unknown } | null>(null);

    // Build the value, dispose it on teardown / rebuild. A *layout* effect so that, on
    // unmount, this dispose runs in the commit's layout phase — before the *passive*
    // effect that detaches the sources it was built over (React flushes all layout
    // cleanups before any passive cleanup). That's the load-bearing dispose-before-detach
    // order. Keyed by `cacheToken`: rebuilds for a new run (param change / StrictMode
    // remount), not on per-render churn. `resolved` is read from the rebuild render.
    useLayoutEffect(() => {
        navTrace('leaf .provide() built — component renders next');
        const value = provideDef.factory(resolved);
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
        // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by cacheToken
    }, [cacheToken]);

    if (!built) return <Loading params={params} />;

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
