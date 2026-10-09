import {
    Fragment,
    Suspense,
    useContext,
    useEffect,
    useId,
    useReducer,
    useRef,
    useSyncExternalStore,
} from 'react';
import type { ComponentType, Context, FC } from 'react';

import { AfterHydration } from './afterHydration.js';
import { MandalaErrorBoundary } from './boundary.js';
import { registerScopeChannel, setScopeLabel } from './channel.js';
import { registerScopeControlsChannel } from './controls.js';
import { HydrationContext, type Hydration } from './hydration.js';
import { LoadingDelay, noDelaySubscribe, notHeld } from './loadingDelay.js';
import { discardRun, RefreshController } from './refresh.js';
import { buildTree, flattenLevels, type Bucket, type Shared } from './resolver.js';
import { RetryPolicy, resolveRetry, type RetryOption, type RetrySettings } from './retryPolicy.js';
import { createRejectionGuard } from './ssrErrors.js';

import type { Scope, ScopeInputs, ScopeProps } from '../scope/scope.js';
import type { SourceError } from '../scope/source.js';
import { startDataTrace, type DataTrace, type DataTraceCause } from '../util/dataTrace.js';
import { deepEqual } from '../util/utils.js';

/*
    The mandala — the one engine under `island()` and `route()`, internal by name: callers see
    `island` / `route`, never "mandala". Its design is docs/current/internals.md.
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
     * Resolve this island's data during a server render? Default `true`. `false` keeps an
     * island out of `prerender`, which gates TTFB on every load: the server ships its
     * `loading` slot and the client resolves after hydration. It wins over an `ssr: true`
     * source inside the island.
     */
    ssr?: boolean;

    /**
     * Keep the last committed content on screen while re-resolving? Default `false`.
     * `useScopeControls().isStale` marks the window, and an error still shows the `error`
     * slot. The kept content is a fresh mount: component-local state does not survive it,
     * and a `.provide()` store does.
     */
    keepStale?: boolean;

    /**
     * Hold the `loading` slot back this many milliseconds (`0`: no delay). Until the deadline
     * a first load renders nothing and a re-resolve keeps the previous content. The deadline
     * measures a stretch without content, and a shown slot stays until content returns.
     * Inert on the server.
     */
    loadingDelayMs?: number;

    /**
     * Re-resolve on failure — ON by default for a failure classified `retryable: true`, with
     * jittered exponential backoff, showing `loading` meanwhile. Terminal and unclassified
     * failures go to the `error` slot. `{ count, backoffMs? }` also retries an unclassified
     * `failed`; `false` opts out. Client-only.
     */
    retry?: RetryOption;

    /**
     * What a server render does with a failed load. `'retry'` (default): the HTML carries
     * the `loading` slot and the client re-runs the load. `'dehydrate'`: the HTML carries
     * the `error` slot, with the failure's `message`, and the client hydrates onto it; it
     * needs a `HydrationProvider`.
     */
    ssrErrors?: 'retry' | 'dehydrate';
};

export type MandalaComponent<S extends Scope<any>> = FC<ScopeInputs<S>> & {
    /**
     * Forwarded from a `lazy()` component the mandala wraps, so `<Link prefetch>` and
     * `prepareRoute` reach a route's chunk whether it is mounted bare or folded into a
     * mandala by `route`.
     */
    preload?: () => Promise<unknown>;
    /** Forwarded from the same `lazy()` component, for the same reason — see {@link lazy}. */
    moduleId?: string;
    /**
     * Set when the mandala keeps its previous run across a re-resolve (`keepStale`,
     * `loadingDelayMs`): the `RouterOutlet` then keys the route by name rather than per
     * navigation, so a param change re-renders this instance instead of remounting it.
     */
    keepsRun?: boolean;
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
 * A committed run held on screen while its successor resolves (`keepStale`): the whole run,
 * so `buckets` stays out of the discard path and `ProvideLeaf` hands over `disposeProvided`.
 * Released — dispose first, then detach — when the successor's leaf commits, or at unmount.
 */
type KeptRun = CommittedOutput & { disposeProvided: (() => void) | null };

/**
 * Lets a kept run go: its `.provide()` value disposes BEFORE `discardRun` detaches the
 * sources it was built over. Passing the `successor` (null at unmount) makes the call a
 * no-op when the same run commits again, so every commit can call it.
 */
function releaseKept(keptRef: { current: KeptRun | null }, successor: Bucket[] | null): void {
    const kept = keptRef.current;
    if (!kept || kept.buckets === successor) return;
    keptRef.current = null;
    kept.disposeProvided?.();
    discardRun(kept.buckets);
}

/**
 * The loading slot, reporting itself and honouring `loadingDelayMs` — a wrapper, because React
 * decides to show a Suspense fallback after the mandala's render returned. Phase is
 * `'loading'` even while the delay holds the slot back: nothing on screen is what loading IS.
 */
function LoadingSlot({
    controller,
    delay,
    loading: Loading,
    inputs,
}: {
    controller: RefreshController;
    delay: LoadingDelay | null;
    loading: ComponentType<{ inputs: unknown }>;
    inputs: unknown;
}) {
    controller.reportPhase('loading', false);
    // The third argument is what makes the delay inert off the client: React reads it for
    // the server render AND the hydration pass, so a slot that belongs in the HTML
    // (`ssr: false`, a source that stays pending server-side, a load that rejected) is
    // rendered there whatever the deadline says.
    const held = useSyncExternalStore(
        delay?.subscribe ?? noDelaySubscribe,
        delay?.getHeld ?? notHeld,
        notHeld,
    );
    // ...and having shown it, the delay must not take it back on the first render that
    // consults the client snapshot.
    if (!held) delay?.expire();
    return held ? null : <Loading inputs={inputs} />;
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

// Why a generation exists, for the data trace's opening line (`rati/debug`): the island
// mounted, the retry counter moved, or the inputs version did. Read off `treeKey` —
// `${version}:${retry}` — the identity the generation is keyed by.
function generationCause(previousKey: string | undefined, retry: number): DataTraceCause {
    if (previousKey === undefined) return 'initial';
    return previousKey.endsWith(`:${retry}`) ? 'inputs' : 'retry';
}

type ErrorSlotComponent = ComponentType<{ inputs: unknown; error: SourceError; retry: () => void }>;

/** Tracks `inputs` by value: `versionRef` counts the changes, `initialInputsRef` holds the first. */
function useInputsVersion<I>(inputs: I) {
    const initialInputsRef = useRef(inputs);
    const inputsRef = useRef(inputs);
    const versionRef = useRef(0);
    if (!deepEqual(inputsRef.current, inputs)) {
        inputsRef.current = inputs;
        versionRef.current += 1;
    }
    return { initialInputsRef, versionRef };
}

/** One generation of the mandala's inner tree: its per-level data-cell caches and run state. */
type Generation = {
    key: string;
    buckets: Bucket[];
    trace: DataTrace | undefined;
    recordedRejections: WeakSet<Promise<unknown>> | undefined;
    guardRejection: ((promise: Promise<unknown>) => Promise<unknown>) | undefined;
};

/** The hydration registry's verbs and slices, bound to one mandala's id. */
type HydrationBinding = Pick<
    Shared,
    'collect' | 'collectError' | 'claim' | 'hydration' | 'seeds' | 'errors'
>;

function bindHydration(
    hydration: Hydration,
    mandalaId: string,
    firstMount: boolean,
    dehydrateErrors: boolean,
): HydrationBinding {
    return {
        hydration: firstMount ? hydration.data?.[mandalaId] : undefined,
        seeds: firstMount ? hydration.seeds?.[mandalaId] : undefined,
        // Same gate, and for the same reason: a retry (manual or the policy's) and an
        // inputs change both mean "run the load", which is precisely what a dehydrated
        // failure is the alternative to.
        errors: firstMount ? hydration.errors?.[mandalaId] : undefined,
        // Bound to this mandala's id; present only on the server (client has no `collect`),
        // where each Step records its resolved promise for the wire.
        collect: hydration.collect
            ? (key, value, kind) => hydration.collect!(mandalaId, key, value, kind)
            : undefined,
        // The island's `ssrErrors` mode rides along: every failure is recorded for the
        // status derivation, and this is what decides whether it also crosses the wire.
        collectError: hydration.collectError
            ? (key, error) => hydration.collectError!(mandalaId, key, error, dehydrateErrors)
            : undefined,
        claim: hydration.claim
            ? (key, section) => hydration.claim!(mandalaId, key, section)
            : undefined,
    };
}

function openGeneration(
    key: string,
    levels: readonly unknown[],
    trace: DataTrace | undefined,
    binding: HydrationBinding,
    dehydrateErrors: boolean,
): Generation {
    return {
        key,
        buckets: levels.map(() => ({
            cells: new Map(),
            sources: [],
            built: false,
            abort: null,
        })),
        trace,
        // Which rejecting loads this generation already reported to the render's error
        // collector (see the resolver's recordRejection). Scoped to the run for the same
        // reason the trace is: a LATER render reusing the same promise instance is a new
        // report, not a duplicate of this one.
        recordedRejections: binding.collectError ? new WeakSet<Promise<unknown>>() : undefined,
        // The rejection-proof twins this generation's Steps wait on under
        // `ssrErrors: 'dehydrate'`, scoped to the run likewise. Gated on the collector: with
        // nothing to carry the failure over, the client paints over the error slot.
        guardRejection: binding.collect && dehydrateErrors ? createRejectionGuard() : undefined,
    };
}

/**
 * Retires the generation a new one replaces. Only a committed run is kept, and only if none
 * already is: a second re-resolve mid-window discards the uncommitted run and keeps the original.
 */
function retireGeneration(
    previous: Generation,
    committed: CommittedOutput | null,
    keepsRun: boolean,
    keptRef: { current: KeptRun | null },
    orphanedRef: { current: Bucket[][] },
): void {
    if (keepsRun && !keptRef.current && committed && committed.buckets === previous.buckets) {
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

/**
 * The leaf's hooks into the run lifecycle — `Shared.commit`, `.swap` and `.retainProvided`.
 * `commitRun` is the leaf's commit, where a run becomes "what is on screen": recording the output
 * there rather than during render is what makes the kept baseline a committed one.
 */
function runCallbacks(
    committedRef: { current: CommittedOutput | null },
    keptRef: { current: KeptRun | null },
    delay: LoadingDelay | null,
    policy: RetryPolicy | null,
) {
    const commitRun = (
        buckets: Bucket[],
        resolved: Record<string, unknown>,
        provided: { value: unknown } | null,
    ) => {
        committedRef.current = { buckets, resolved, provided };
        // Content is on screen, so the delay has nothing to hold back and the next
        // stretch without content gets the full deadline again...
        delay?.settled();
        // ...and whatever failure the retry policy was working through is over, however
        // many attempts it took: the budget is per failure streak, not per island.
        policy?.reset();
    };

    // The swap, run from the leaf's PASSIVE effect: every layout effect of the commit has run,
    // so a source both runs hold is never detached and re-attached. A mandala effect cannot do
    // it: a Suspense retry re-renders the boundary's children, not the mandala.
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

    return { commitRun, swapRun, retainProvided };
}

/**
 * The retry a person asked for — the error slot's prop, `useScopeControls().retry`, `refresh()`
 * with no key — resets the automatic budget. A ref keeps the slot's `retry` identity stable;
 * without a policy it IS `bumpRetry`.
 */
function useManualRetry(
    retrySettings: RetrySettings | null,
    policyRef: { current: RetryPolicy | null },
    bumpRetry: () => void,
): () => void {
    const manualRetryRef = useRef<(() => void) | null>(null);
    if (retrySettings) {
        manualRetryRef.current ??= () => {
            policyRef.current?.reset();
            bumpRetry();
        };
    }
    return manualRetryRef.current ?? bumpRetry;
}

/** The mandala's unmount: every run it still holds goes, and its pending countdowns with it. */
function teardownRun(
    cacheRef: { current: Generation | null },
    orphanedRef: { current: Bucket[][] },
    keptRef: { current: KeptRun | null },
    delayRef: { current: LoadingDelay | null },
    policyRef: { current: RetryPolicy | null },
): void {
    discardRun(cacheRef.current?.buckets);
    // An unmount racing a generation change can leave a bucket queued but
    // unswept (the effect above never ran for it).
    for (const buckets of orphanedRef.current) discardRun(buckets);
    orphanedRef.current = [];
    // The run `keepStale` was holding on screen: the island is gone, so there
    // is nothing left to keep it for. Same order as the swap.
    releaseKept(keptRef, null);
    // ...and nothing left to delay or retry: the pending countdowns go with it.
    delayRef.current?.dispose();
    policyRef.current?.dispose();
    cacheRef.current = null;
}

/**
 * The resolver's server-side error path: the run's guard, plus the error slot the Step renders in
 * place of the throw React would hand to nobody. Undefined without a guard.
 */
function ssrErrorPath(
    guard: Generation['guardRejection'],
    ErrorSlot: ErrorSlotComponent | undefined,
    inputs: unknown,
    retry: () => void,
): Shared['ssrErrors'] {
    if (!guard) return undefined;
    return {
        guard,
        slot: ErrorSlot
            ? (error: SourceError) => <ErrorSlot inputs={inputs} error={error} retry={retry} />
            : null,
    };
}

function forwardLazy(
    mandala: Pick<MandalaComponent<Scope>, 'preload' | 'moduleId'>,
    component: unknown,
): void {
    const lazyComponent = component as {
        preload?: () => Promise<unknown>;
        moduleId?: string;
    };
    if (typeof lazyComponent.preload === 'function') mandala.preload = lazyComponent.preload;
    if (lazyComponent.moduleId !== undefined) mandala.moduleId = lazyComponent.moduleId;
}

/**
 * Builds a mandala component from a scope, a component and slots. `kindLabel` is the public
 * concept the caller represents (`Island` / `Route`) — the React `displayName` and the
 * scope's read-error label, so callers never see "mandala".
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
    // Undefined means "no slot": the boundary rethrows to the nearest outer one, and a
    // server render has nothing deterministic to paint (see `ssrErrors`).
    const ErrorSlot = config.error as ErrorSlotComponent | undefined;
    const levels = flattenLevels(config.scope as Scope);
    // Build-time constants, so the element tree below keeps one stable shape per mandala.
    const ssrEnabled = config.ssr !== false;
    const keepStale = config.keepStale === true;
    const delayMs = config.loadingDelayMs ?? 0;
    const delayed = delayMs > 0;
    // Both options ride the kept-run machinery: `keepStale` holds the previous run for the
    // whole re-resolution, a bare delay until its deadline.
    const keepsRun = keepStale || delayed;
    // Absent means the default policy (classified failures only); `false` or `count: 0` means
    // no policy and no wrapper on the manual retry.
    const retrySettings = resolveRetry(config.retry);
    const dehydrateErrors = config.ssrErrors === 'dehydrate';
    const provideChannel = (config.scope as Scope).provideDef?.channel;

    // The public identity of this mandala — the React displayName, the scope's read-error
    // label, and the data trace's per-line prefix. Computed before the component so the
    // render body can use it too.
    const componentName =
        config.component.displayName ?? (config.component as { name?: string }).name;
    const displayName = `${kindLabel}(${componentName || 'Component'})`;

    const Mandala = function Mandala(inputs: ScopeInputs<S>) {
        // Stable across server render and client hydration by tree position, so it keys
        // this mandala's slice of the SSR dehydration registry (see hydration.tsx).
        const mandalaId = useId();
        const hydration = useContext(HydrationContext);

        // Retry re-mounts the inner tree (fresh promises/sources) on error-slot retry.
        const [retry, bumpRetry] = useReducer((count: number) => count + 1, 0);

        // A version bump on an inputs change by value remounts the inner tree, children first,
        // so the `.provide()` value disposes before its sources detach. Source transitions
        // re-render in place, keeping promise and source identity.
        const { initialInputsRef, versionRef } = useInputsVersion(inputs);
        const treeKey = `${versionRef.current}:${retry}`;

        // Seed from server-resolved values only on this mandala's FIRST resolution: a
        // retry must re-fetch, and an inputs change wants the new inputs' data. The
        // post-hydration source re-render keeps (retry 0, initial inputs), consistent
        // with the server HTML.
        const firstMount = retry === 0 && deepEqual(inputs, initialInputsRef.current);
        const binding = bindHydration(hydration, mandalaId, firstMount, dehydrateErrors);

        // Per-level data-cell caches, rebuilt when the inner tree remounts (treeKey
        // change). Held on the mandala's committed ref so a Step's `use()` suspension
        // can't discard a half-built cell (which would re-run its load forever).
        const cacheRef = useRef<Generation | null>(null);
        // Buckets the line below replaced, awaiting the commit effect's sweep: a source erroring
        // or a mid-tree source dropping to pending tears levels down with NO remount, and a
        // Step's detach defers to that sweep.
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
        // The `loadingDelayMs` gate, one per instance and only when the option is set — see
        // loadingDelay.ts. Null is the whole default path: no window, no timer, no
        // subscription that ever fires.
        const delayRef = useRef<LoadingDelay | null>(null);
        if (delayed) delayRef.current ??= new LoadingDelay(delayMs);
        const delay = delayRef.current;
        // The `retry` policy, same shape: one per instance, only when the option is set —
        // without it nothing below this line does anything at all.
        const policyRef = useRef<RetryPolicy | null>(null);
        if (retrySettings) policyRef.current ??= new RetryPolicy(retrySettings);
        const policy = policyRef.current;
        if (!cacheRef.current || cacheRef.current.key !== treeKey) {
            const previous = cacheRef.current;
            const committed = committedRef.current;
            // A resolution starts here — the generation being built IS the resolution —
            // so this is where the delay's window opens (timer-less; see LoadingDelay).
            delay?.begin();
            if (previous) retireGeneration(previous, committed, keepsRun, keptRef, orphanedRef);
            committedRef.current = null;
            // A generation is a data-trace run: fresh timeline, and a cause to open it
            // with. Undefined unless `globalThis.__DEBUG__.data` is on.
            const trace = startDataTrace(displayName, generationCause(previous?.key, retry));
            cacheRef.current = openGeneration(treeKey, levels, trace, binding, dehydrateErrors);
        }

        // Is the delay holding the loading slot back right now? Read after the block above,
        // so a window that just opened is already visible here. Inert (and unsubscribed)
        // without the option, and `false` on the server / through hydration — same reasoning
        // as the slot's own read.
        const held = useSyncExternalStore(
            delay?.subscribe ?? noDelaySubscribe,
            delay?.getHeld ?? notHeld,
            notHeld,
        );

        // A bare re-render trigger (does not change treeKey), used by the effects below
        // and by the refresh controller (dirty cells / swapped values re-render in place).
        const [, forceRebuild] = useReducer((count: number) => count + 1, 0);

        const manualRetry = useManualRetry(retrySettings, policyRef, bumpRetry);

        // The resolver's server-side error path: the run's guard plus the error slot. Present
        // only on a collected server render of a `'dehydrate'` island, both conditions
        // `guardRejection` carries.
        const guard = cacheRef.current.guardRejection;
        const ssrErrors = ssrErrorPath(guard, ErrorSlot, inputs, manualRetry);

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
            fullRefresh: manualRetry,
        });
        // The policy's verbs, wired the same way: its own retry is the UNWRAPPED bump —
        // an automatic attempt continues the streak rather than restarting it.
        policy?.wire({ retry: bumpRetry, report: controller.reportRetrying });

        // A committed remount (inputs change, retry) settles the refresh bookkeeping and
        // discards the replaced generation: its loads abort, and it releases what its Steps
        // left attached. Off the render path: a discarded render must not cancel or detach.
        useEffect(() => {
            controller.treeCommitted(treeKey);
            const orphaned = orphanedRef.current;
            orphanedRef.current = [];
            for (const buckets of orphaned) discardRun(buckets);
        }, [controller, treeKey]);

        // Drops the cache on unmount, so a StrictMode remount rebuilds a fresh run, and forces
        // the one re-render that rebuild needs. The sweep is the sources' unmount backstop,
        // after the leaf's layout-phase dispose (dispose before detach), and it aborts the
        // run's in-flight loads.
        useEffect(() => {
            if (cacheRef.current === null) forceRebuild();
            return () => teardownRun(cacheRef, orphanedRef, keptRef, delayRef, policyRef);
        }, []);

        const callbacks = runCallbacks(committedRef, keptRef, delay, policy);

        // `Shared.slot`: the loading slot, or the kept run standing in for it — for the whole
        // re-resolution under `keepStale`, until the deadline under a bare `loadingDelayMs`.
        // Built once here so all three sites share one element (docs/current/internals.md).
        const kept = keptRef.current;
        const showKept = kept !== null && (keepStale || held);
        const slot = showKept ? (
            <KeptContent
                kept={kept}
                channel={Channel}
                appChannel={provideChannel}
                component={config.component as ComponentType<any>}
                controller={controller}
            />
        ) : (
            <LoadingSlot controller={controller} delay={delay} loading={Loading} inputs={inputs} />
        );

        // Two things the delay needs, both after the children's effects (so the leaf's
        // commit has already reported content on screen): start the countdown of an open
        // window, and — once the deadline has moved the kept run off screen — let that run
        // go, in the same dispose-then-detach order the swap uses.
        useEffect(() => {
            delay?.arm();
            if (!showKept) releaseKept(keptRef, null);
            // Which inputs the island is now resolving — the retry policy drops a countdown
            // left over from the previous ones here (see RetryPolicy.committed). Effect-time
            // and compared rather than reset, so the commit that ARMED an attempt can't
            // cancel it on the way out.
            policy?.committed(versionRef.current);
        });

        const shared: Shared = {
            scope: config.scope as Scope,
            component: config.component as ComponentType<any>,
            channel: Channel,
            slot,
            buckets: cacheRef.current.buckets,
            bucketRetained: (index, bucket) =>
                cacheRef.current?.buckets[index] === bucket ||
                keptRef.current?.buckets[index] === bucket,
            controller: binding.collect ? undefined : controller,
            ...binding,
            recordedRejections: cacheRef.current.recordedRejections,
            ssrErrors,
            trace: cacheRef.current.trace,
            // The leaf reports its commit only where something reads it: with none of the
            // options there is no baseline to keep and no streak to end.
            commit: keepsRun || retrySettings ? callbacks.commitRun : undefined,
            swap: keepsRun ? callbacks.swapRun : undefined,
            retainProvided: keepsRun ? callbacks.retainProvided : undefined,
        };

        const tree = <Fragment key={treeKey}>{buildTree(levels, 0, inputs, shared)}</Fragment>;

        return (
            <ControlsChannel.Provider value={controller}>
                <MandalaErrorBoundary
                    errorSlot={ErrorSlot}
                    inputs={inputs}
                    retry={manualRetry}
                    resetKey={treeKey}
                    controller={controller}
                    policy={policy}
                    slot={slot}
                >
                    <Suspense fallback={slot}>
                        {ssrEnabled ? (
                            tree
                        ) : (
                            // Opted out: no Step renders server-side, so no load starts and
                            // the collector stays empty for this island.
                            <AfterHydration fallback={slot}>{tree}</AfterHydration>
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
    forwardLazy(Mandala, config.component);

    // Tell the RouterOutlet not to remount this one on every navigation — a kept run cannot
    // survive its own island being replaced. See MandalaComponent.keepsRun.
    if (keepsRun) Mandala.keepsRun = true;

    // A readable identifier for this scope's read errors (best-effort: shared scopes keep
    // the last mandala's label).
    setScopeLabel(scopeKey, displayName);

    return Mandala;
}
