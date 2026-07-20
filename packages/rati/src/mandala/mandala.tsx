import { Fragment, Suspense, useContext, useEffect, useId, useReducer, useRef } from 'react';
import type { ComponentType, Context, FC, ReactNode } from 'react';
import type { Scope, ScopeInputs, ScopeProps } from '../scope/scope';
import type { SourceError } from '../scope/source';
import { deepEqual } from '../util/utils';
import { startDataTrace, type DataTrace, type DataTraceCause } from '../util/dataTrace';
import { buildTree, flattenLevels, type Bucket, type Shared } from './resolver';
import { registerScopeChannel, setScopeLabel } from './channel';
import { registerScopeControlsChannel } from './controls';
import { discardRun, RefreshController } from './refresh';
import { MandalaErrorBoundary } from './boundary';
import { HydrationContext } from './hydration';
import { AfterHydration } from './afterHydration';

/*
    The mandala — rati's core renderable unit, the shared abstraction under `island()`
    (standalone) and `route()` (URL-bound). A mandala is a *scope* (declarative data
    definition) bound to a component with loading/error slots; it resolves its own data,
    provides the resolved value to its subtree (read with `useScope`), and manages the
    sources' attach/detach + the `.provide()` value's dispose in lockstep with its own
    lifetime. See resolver.tsx for the Step-tree resolution mechanics, channel.ts for the
    value channel, hydration.tsx for SSR dehydration.

    Internal name only: callers see `island` / `route`, never "mandala".
*/

type MandalaFallbackProps<S extends Scope<any>> = {
    inputs: ScopeInputs<S>;
    retry: () => void;
};

export type MandalaConfig<S extends Scope<any>> = {
    /** The declarative data definition (a scope value). */
    scope: S;

    /** Gets clean, fully resolved props — no loading/error states inside. */
    component: ComponentType<ScopeProps<S>>;

    /**
     * Shown while the scope resolves — also the `<Suspense>` fallback for a pending
     * promise entry. Defaults to rendering nothing.
     */
    loading?: ComponentType<{ inputs: ScopeInputs<S> }>;

    /**
     * Rendered on any failure. not-available / forbidden / failed all arrive here as a
     * `SourceError` — switch on `error.code` to distinguish them. When omitted, the error
     * is thrown during render so the nearest ErrorBoundary handles it.
     */
    error?: ComponentType<MandalaFallbackProps<S> & { error: SourceError }>;

    /**
     * Resolve this island's data during a server render? Default `true`.
     *
     * `prerender` is all-or-nothing: every promise load on the page gates TTFB. Set
     * `false` on an island that shouldn't hold the document up — below the fold,
     * expensive, or personalized — and the server ships its `loading` slot instead. The
     * client renders that same slot through hydration, then resolves normally.
     *
     * The opt-out is the island's, so it wins over anything inside its scope: a source
     * marked `ssr: true` in an `ssr: false` island does not resolve server-side either.
     * On a client-only render (no server in the picture) the option does nothing.
     */
    ssr?: boolean;

    /**
     * Keep the previous content on screen while re-resolving? Default `false`.
     *
     * A param change or `refresh()` re-resolves the whole scope, which normally blanks the
     * screen back to the `loading` slot. With `keepStale`, the island keeps rendering what
     * it last committed until the new resolution is ready, then swaps — the islands
     * reading of stale-while-revalidate. The first load has nothing to keep and is
     * unchanged; an error during the re-resolve shows the `error` slot rather than leaving
     * stale content passing for current.
     *
     * The kept props were resolved for the *previous* inputs, so the subtree can briefly
     * see old data under a new URL — that is the feature, and `useScopeControls().isStale`
     * is how a component knows to say so (dim it, badge it).
     */
    keepStale?: boolean;
};

export type MandalaComponent<S extends Scope<any>> = FC<ScopeInputs<S>> & {
    /**
     * Forwarded from a `lazy()` component the mandala wraps, so the mandala is a
     * transparent entry point: the router's `<Link prefetch>` / `prepareRoute` preload
     * reach a route's chunk whether it is mounted as a bare component or folded into a
     * mandala by `route`. Absent when the component isn't lazy.
     */
    preload?: () => Promise<unknown>;
    /** Forwarded from the same `lazy()` component, for the same reason — see {@link lazy}. */
    moduleId?: string;
    /**
     * Set when the mandala was built with `keepStale`, so the `Router` can tell. It keys a
     * route's element by a per-navigation counter, which remounts the component on every
     * navigation — and a remounted island has no previous run left to keep. For these the
     * Router keys by route name instead, so a param change on the same route re-renders
     * this instance (the mandala's own param-change path) rather than replacing it.
     * Absent otherwise, and the default keying is untouched.
     */
    keepStale?: boolean;
};

const DefaultLoading: FC<{ inputs: unknown }> = () => null;

/** What a run's leaf put on screen, recorded at commit — the baseline `keepStale` keeps. */
type CommittedOutput = {
    buckets: Bucket[];
    resolved: Record<string, unknown>;
    /** The `.provide()` value, when the scope declares one; null for provide-by-default. */
    provided: { value: unknown } | null;
};

/**
 * A committed run held on screen while its successor resolves (`keepStale`). It is the
 * whole run, not a snapshot of it: `buckets` stays out of the discard path, so the Steps'
 * cleanups leave its sources attached and `ProvideLeaf` hands over `disposeProvided`
 * instead of running it. Released — dispose first, then detach — when the successor's leaf
 * commits, or at unmount.
 */
type KeptRun = CommittedOutput & { disposeProvided: (() => void) | null };

/**
 * Let a kept run go, in the order the engine guarantees everywhere else: the `.provide()`
 * value it was still publishing disposes *before* `discardRun` detaches the sources that
 * value was built over. `successor` is the run taking over (null at unmount) — passing it
 * makes the call a no-op when the same run commits again, so this is safe to call on every
 * commit rather than only on the swap.
 */
function releaseKept(keptRef: { current: KeptRun | null }, successor: Bucket[] | null): void {
    const kept = keptRef.current;
    if (!kept || kept.buckets === successor) return;
    keptRef.current = null;
    kept.disposeProvided?.();
    discardRun(kept.buckets);
}

/**
 * The loading slot, reporting itself. A wrapper rather than a call in the mandala's render
 * because React is what decides to show a Suspense fallback — by the time this renders, the
 * mandala's own render has long since returned.
 */
function LoadingSlot({
    controller,
    children,
}: {
    controller: RefreshController;
    children: ReactNode;
}) {
    controller.reportPhase('loading', false);
    return children;
}

/**
 * The stale window's content: the kept run's component, fed the props it committed with,
 * publishing what it published. Not a re-resolution — nothing here runs a load or touches
 * a cell; it renders a run that is already finished and is being held on screen.
 */
function KeptContent({
    kept,
    channel,
    appChannel,
    component: Component,
    controller,
}: {
    kept: KeptRun;
    channel: Context<unknown>;
    appChannel: Context<any> | undefined;
    component: ComponentType<any>;
    controller: RefreshController;
}) {
    // Content is on screen — it just belongs to the run before this one.
    controller.reportPhase('ready', true);
    // `.provide()` value when the scope declares one, else the resolved props — the same
    // choice the leaf makes, so `useScope` reads one type across the swap.
    const value = kept.provided ? kept.provided.value : kept.resolved;
    const content = (
        <channel.Provider value={value}>
            <Component {...kept.resolved} />
        </channel.Provider>
    );
    if (!appChannel) return content;
    return <appChannel.Provider value={value}>{content}</appChannel.Provider>;
}

// Why a generation exists, for the data trace's opening line (`rati/debug`): there was no
// previous one (the island mounted), the retry counter moved (an error-slot retry), or the
// inputs version did (a param change). Read off `treeKey` — `${version}:${retry}` — which
// is the identity the generation is keyed by anyway.
function generationCause(previousKey: string | undefined, retry: number): DataTraceCause {
    if (previousKey === undefined) return 'initial';
    return previousKey.endsWith(`:${retry}`) ? 'inputs' : 'retry';
}

/**
 * Build a mandala component from a scope + component + slots. `kindLabel` is the public
 * concept the caller represents (`Island` / `Route`) — used for the React `displayName`
 * and the scope's read-error label, so callers never see "mandala". The two public
 * wrappers (`island`, `route`) are thin calls onto this.
 */
export function createMandala<S extends Scope<any>>(
    config: MandalaConfig<S>,
    kindLabel: string,
): MandalaComponent<S> {
    // One value channel per scope identity: mandalas built from the same scope share it,
    // so a descendant reading by scope resolves the nearest one's value.
    const scopeKey = config.scope as object;
    const Channel = registerScopeChannel(scopeKey);
    const ControlsChannel = registerScopeControlsChannel(scopeKey);
    const Loading = (config.loading ?? DefaultLoading) as ComponentType<{ inputs: unknown }>;
    const levels = flattenLevels(config.scope as Scope);
    // Build-time constants, so the element tree below keeps one stable shape per mandala.
    const ssrEnabled = config.ssr !== false;
    const keepStale = config.keepStale === true;
    const provideChannel = (config.scope as Scope).provideDef?.channel;

    // The public identity of this mandala — the React displayName, the scope's read-error
    // label, and the data trace's per-line prefix. Computed before the component so the
    // render body can use it too.
    const componentName =
        config.component.displayName ?? (config.component as { name?: string }).name;
    const displayName = `${kindLabel}(${componentName || 'Component'})`;

    // Plain function component: source reactivity now lives in each Step's
    // useSyncExternalStore, so the mandala no longer needs to be an observer.
    const Mandala = function Mandala(inputs: ScopeInputs<S>) {
        // Stable across server render and client hydration by tree position, so it keys
        // this mandala's slice of the SSR dehydration registry (see hydration.tsx).
        const mandalaId = useId();
        const hydration = useContext(HydrationContext);

        // Retry re-mounts the inner tree (fresh promises/sources) on error-slot retry.
        const [retry, bumpRetry] = useReducer((count: number) => count + 1, 0);

        // Bump a version when inputs change by value, so the inner tree remounts — React
        // tears the old one down (children first: the `.provide()` value disposes before
        // its sources detach) and resolves the new inputs from scratch. Source transitions
        // (same inputs) re-render in place, keeping promise/source identity.
        const initialInputsRef = useRef(inputs);
        const inputsRef = useRef(inputs);
        const versionRef = useRef(0);
        if (!deepEqual(inputsRef.current, inputs)) {
            inputsRef.current = inputs;
            versionRef.current += 1;
        }
        const treeKey = `${versionRef.current}:${retry}`;

        // Seed from server-resolved values only on this mandala's *first* resolution: a
        // retry must re-fetch, and an inputs change wants the new inputs' data. The
        // post-hydration source re-render keeps (retry 0, initial inputs), consistent
        // with the server HTML.
        const firstMount = retry === 0 && deepEqual(inputs, initialInputsRef.current);
        const hydrationSlice = firstMount ? hydration.data?.[mandalaId] : undefined;
        const seedsSlice = firstMount ? hydration.seeds?.[mandalaId] : undefined;

        // Bound to this mandala's id; present only on the server (client has no `collect`),
        // where each Step records its resolved promise for the wire.
        const collect = hydration.collect
            ? (key: string, value: unknown, kind: 'value' | 'seed') =>
                  hydration.collect!(mandalaId, key, value, kind)
            : undefined;
        const collectError = hydration.collectError
            ? (key: string, error: SourceError) => hydration.collectError!(mandalaId, key, error)
            : undefined;
        const claim = hydration.claim
            ? (key: string, section: 'data' | 'seeds') => hydration.claim!(mandalaId, key, section)
            : undefined;

        // Per-level data-cell caches, rebuilt when the inner tree remounts (treeKey
        // change). Held on the mandala's committed ref so a Step's `use()` suspension
        // can't discard a half-built cell (which would re-run its load forever).
        const cacheRef = useRef<{
            key: string;
            buckets: Bucket[];
            trace: DataTrace | undefined;
            recordedRejections: WeakSet<Promise<unknown>> | undefined;
        } | null>(null);
        // Buckets the line below replaced, awaiting the sweep in the commit effect. A Step
        // torn down while its bucket was still live keeps its sources attached on purpose
        // (it can't tell a source swap from an unmount — see the resolver's detach effect)
        // and defers to a sweep; but a source erroring or a mid-tree source dropping to
        // pending tears levels down with *no* remount, so without this the next generation
        // would orphan that bucket and its still-attached sources would never detach.
        const orphanedRef = useRef<Bucket[][]>([]);
        // What the current run's leaf last put on screen, and the run it belongs to. Written
        // at commit (the leaf's layout effect), so a discarded render never becomes the
        // stale baseline. Null until this run's leaf commits.
        const committedRef = useRef<CommittedOutput | null>(null);
        // The previous run, still on screen while this one resolves (`keepStale`). Whole,
        // not a snapshot: its buckets stay live, so its sources stay attached and its
        // `.provide()` value stays alive — the stale content is the run that produced it,
        // frozen, rather than a re-render over torn-down resources.
        const keptRef = useRef<KeptRun | null>(null);
        if (!cacheRef.current || cacheRef.current.key !== treeKey) {
            const previous = cacheRef.current;
            const committed = committedRef.current;
            if (previous) {
                // Only a run that reached the screen is worth keeping — and only if none
                // already is. A second re-resolve mid-stale-window discards the run that
                // never committed and keeps showing the original: swapping in a half-built
                // replacement would blank exactly what `keepStale` exists to preserve.
                if (
                    keepStale &&
                    !keptRef.current &&
                    committed &&
                    committed.buckets === previous.buckets
                ) {
                    keptRef.current = {
                        buckets: previous.buckets,
                        resolved: committed.resolved,
                        provided: committed.provided,
                        disposeProvided: null,
                    };
                } else {
                    orphanedRef.current.push(previous.buckets);
                }
            }
            committedRef.current = null;
            cacheRef.current = {
                key: treeKey,
                buckets: levels.map(() => ({
                    cells: new Map(),
                    sources: [],
                    built: false,
                    abort: null,
                })),
                // A generation is a data-trace run: fresh timeline, and a cause to open it
                // with. Undefined unless `globalThis.__DEBUG__.data` is on.
                trace: startDataTrace(displayName, generationCause(previous?.key, retry)),
                // Which rejecting loads this generation already reported to the render's
                // error collector (see the resolver's recordRejection). Scoped to the run
                // for the same reason the trace is: a *later* render reusing the same
                // promise instance is a new report, not a duplicate of this one.
                recordedRejections: collectError ? new WeakSet<Promise<unknown>>() : undefined,
            };
        }

        // A bare re-render trigger (does not change treeKey), used by the effects below
        // and by the refresh controller (dirty cells / swapped values re-render in place).
        const [, forceRebuild] = useReducer((count: number) => count + 1, 0);

        // The instance's refresh controller — the value behind `useScopeControls`. Wired
        // every render so it always sees the current run's buckets; created once so the
        // channel value (and the hook's verbs) stay referentially stable.
        const controllerRef = useRef<RefreshController | null>(null);
        controllerRef.current ??= new RefreshController();
        const controller = controllerRef.current;
        controller.wire({
            levels,
            buckets: cacheRef.current.buckets,
            treeKey,
            notify: forceRebuild,
            fullRefresh: bumpRetry,
        });

        // A committed remount (inputs change / retry) tears the old cells down —
        // outstanding refresh bookkeeping settles wholesale, and the generation it replaced
        // is discarded: its in-flight loads abort, and it releases whatever its Steps left
        // attached. Off the render path on purpose: a discarded render must not cancel or
        // detach anything. Idempotent both ways — the ordinary remount path has already
        // detached through the Steps' own cleanups (by then the live buckets are the new
        // ones), so this finds only what those deferred.
        useEffect(() => {
            controller.treeCommitted(treeKey);
            const orphaned = orphanedRef.current;
            orphanedRef.current = [];
            for (const buckets of orphaned) discardRun(buckets);
        }, [controller, treeKey]);

        // Drop the cache on unmount so a StrictMode remount (mount → cleanup → mount)
        // rebuilds a fresh run instead of reusing the torn-down one's cells/sources. On
        // the remount the cache is null, so force one re-render to rebuild it into a fresh
        // run — the mandala used to get this re-render for free as a mobx `observer`; now
        // it's explicit. The subtree then reads the surviving run's identities. A real
        // (production) mount runs once with the cache non-null, so it adds no render there.
        // The sweep is the sources' unmount backstop: Step cleanups keep entries their
        // live bucket still holds (they can't tell a source swap from an unmount), so the
        // final detach of everything still attached happens here — after the leaf's
        // layout-phase dispose, preserving the dispose-before-detach order. The loads the
        // run still has in flight are aborted in the same pass (`discardRun`): an island
        // that is gone has no reader for them.
        useEffect(() => {
            if (cacheRef.current === null) forceRebuild();
            return () => {
                discardRun(cacheRef.current?.buckets);
                // An unmount racing a generation change can leave a bucket queued but
                // unswept (the effect above never ran for it).
                for (const buckets of orphanedRef.current) discardRun(buckets);
                orphanedRef.current = [];
                // The run `keepStale` was holding on screen: the island is gone, so there
                // is nothing left to keep it for. Same order as the swap below.
                releaseKept(keptRef, null);
                cacheRef.current = null;
            };
        }, []);

        // The leaf's commit — where a run becomes "what is on screen". Recording the
        // output here rather than during render is what makes the kept baseline a
        // *committed* one: a render React discards never reaches this.
        const commitRun = (
            buckets: Bucket[],
            resolved: Record<string, unknown>,
            provided: { value: unknown } | null,
        ) => {
            committedRef.current = { buckets, resolved, provided };
        };

        // The swap: the successor is on screen, so the run it replaced can go. Split from
        // `commitRun` and driven from the leaf's *passive* effect for two reasons. The
        // phase: every layout effect of the commit — including the new Steps' source
        // attach — has run by then, so a source both runs hold is never detached and
        // re-attached across the window. And the caller: a Suspense retry re-renders the
        // boundary's children, not the mandala, so an effect of the mandala's own would
        // simply not run on the commit that ends the window.
        const swapRun = (buckets: Bucket[]) => {
            releaseKept(keptRef, buckets);
        };

        // A retiring `ProvideLeaf` offering its dispose: taken only when its run is the one
        // being kept, in which case the value stays alive (and published) until the swap
        // releases it. Everything else disposes on the spot, as always.
        const retainProvided = (buckets: Bucket[], dispose: () => void): boolean => {
            const kept = keptRef.current;
            if (!kept || kept.buckets !== buckets) return false;
            kept.disposeProvided = dispose;
            return true;
        };

        // The kept run's content, standing in for the loading slot at every site the slot
        // can appear. Built here so all three share one element — and one identity, so the
        // component doesn't remount as the tree moves between them.
        const kept = keptRef.current;
        const staleContent = kept ? (
            <KeptContent
                kept={kept}
                channel={Channel}
                appChannel={provideChannel}
                component={config.component as ComponentType<any>}
                controller={controller}
            />
        ) : undefined;

        const shared: Shared = {
            scope: config.scope as Scope,
            component: config.component as ComponentType<any>,
            channel: Channel,
            loading: Loading,
            inputs,
            buckets: cacheRef.current.buckets,
            bucketRetained: (index, bucket) =>
                cacheRef.current?.buckets[index] === bucket ||
                keptRef.current?.buckets[index] === bucket,
            controller: collect ? undefined : controller,
            collect,
            collectError,
            recordedRejections: cacheRef.current.recordedRejections,
            claim,
            hydration: hydrationSlice,
            seeds: seedsSlice,
            trace: cacheRef.current.trace,
            // The leaf reports its commit only where something reads it: with `keepStale`
            // off there is no baseline to keep, and the default path stays untouched.
            commit: keepStale ? commitRun : undefined,
            swap: keepStale ? swapRun : undefined,
            retainProvided: keepStale ? retainProvided : undefined,
            staleContent,
        };

        // The one element the loading slot is: the Suspense fallback, and — under
        // `ssr: false` — what stands in for the whole tree until the client has hydrated.
        // While a kept run is on screen it stands in for the slot itself (`keepStale`).
        const loadingSlot = staleContent ?? (
            <LoadingSlot controller={controller}>
                <Loading inputs={inputs} />
            </LoadingSlot>
        );
        const tree = <Fragment key={treeKey}>{buildTree(levels, 0, inputs, shared)}</Fragment>;

        return (
            <ControlsChannel.Provider value={controller}>
                <MandalaErrorBoundary
                    errorSlot={
                        config.error as
                            | ComponentType<{
                                  inputs: unknown;
                                  error: SourceError;
                                  retry: () => void;
                              }>
                            | undefined
                    }
                    inputs={inputs}
                    retry={bumpRetry}
                    resetKey={treeKey}
                    controller={controller}
                >
                    <Suspense fallback={loadingSlot}>
                        {ssrEnabled ? (
                            tree
                        ) : (
                            // Opted out: no Step renders server-side, so no load starts and
                            // the collector stays empty for this island.
                            <AfterHydration fallback={loadingSlot}>{tree}</AfterHydration>
                        )}
                    </Suspense>
                </MandalaErrorBoundary>
            </ControlsChannel.Provider>
        );
    } as MandalaComponent<S>;

    Mandala.displayName = displayName;

    // Stay transparent to chunk preloading: a `lazy()` component hangs `.preload` and
    // (built through rati/vite) its `.moduleId` on itself; surface both on the mandala,
    // so the router can prefetch through the wrapper and a server render can name the
    // chunk of a route that folded its scope in.
    const lazyComponent = config.component as {
        preload?: () => Promise<unknown>;
        moduleId?: string;
    };
    if (typeof lazyComponent.preload === 'function') Mandala.preload = lazyComponent.preload;
    if (lazyComponent.moduleId !== undefined) Mandala.moduleId = lazyComponent.moduleId;

    // Tell the Router not to remount this one on every navigation — a kept run cannot
    // survive its own island being replaced. See MandalaComponent.keepStale.
    if (keepStale) Mandala.keepStale = true;

    // A readable identifier for this scope's read errors (best-effort: shared scopes keep
    // the last mandala's label).
    setScopeLabel(scopeKey, displayName);

    return Mandala;
}
