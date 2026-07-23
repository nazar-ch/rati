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
import type { Scope, ScopeInputs, ScopeProps } from '../scope/scope';
import type { SourceError } from '../scope/source';
import { deepEqual } from '../util/utils';
import { startDataTrace, type DataTrace, type DataTraceCause } from '../util/dataTrace';
import { buildTree, flattenLevels, type Bucket, type Shared } from './resolver';
import { registerScopeChannel, setScopeLabel } from './channel';
import { registerScopeControlsChannel } from './controls';
import { discardRun, RefreshController } from './refresh';
import { LoadingDelay, noDelaySubscribe, notHeld } from './loadingDelay';
import { RetryPolicy, type RetryOptions } from './retryPolicy';
import { createRejectionGuard } from './ssrErrors';
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
     * is how a component knows to say so (dim it, badge it). The continuity is visual, not
     * instance-level: the kept content is a fresh mount of the component (and the swap
     * mounts another), so component-local state does not survive the window — a store
     * (`.provide()`, which is kept alive) does.
     */
    keepStale?: boolean;

    /**
     * Hold the `loading` slot back for this many milliseconds. Default `0` (no delay) —
     * `0` and absent are the same thing.
     *
     * A resolution that settles in tens of milliseconds still renders its loading slot for
     * a frame or two, which reads as a flash. With a delay the island renders **nothing**
     * until the deadline (first load) or keeps the **previous content** (a re-resolve —
     * `keepStale`'s mechanism, borrowed for the length of the window), and a resolution
     * that beats the deadline never shows the slot at all.
     *
     * The deadline measures a stretch without content, not one resolution: a second
     * re-resolve arriving mid-window doesn't push the slot further out, and once the slot
     * is up nothing takes it back until content returns. It composes with `keepStale` —
     * with both set the slot appears only for a slow *first* load. Inert on the server,
     * which waits for the resolution regardless.
     */
    loadingDelayMs?: number;

    /**
     * Re-resolve automatically when the resolution fails? Absent (the default) means no
     * automatic retry: a failure shows the `error` slot at once, as it always has.
     *
     * `{ count, backoffMs }` — up to `count` further attempts, waiting `backoffMs` before
     * the first and doubling for each one after (`{ count: 3, backoffMs: 500 }` → 500ms,
     * 1s, 2s). While the policy is working the island is *not* in its error state: it shows
     * the `loading` slot (or the kept run, under `keepStale`) and
     * `useScopeControls().retrying` says which attempt is in flight. Only once the budget
     * is spent does the `error` slot come up — with its manual `retry`, which buys a fresh
     * budget.
     *
     * **`failed` only.** A `not-available` — or any other code a load coins — is an answer,
     * not a transient fault; retrying it just delays the 404 the user is owed.
     *
     * Client-only: a server render takes its one attempt per request and reports the
     * failure as always.
     */
    retry?: RetryOptions;

    /**
     * What a server render does with a load that *failed*. Default `'retry'`.
     *
     * `'retry'` is React's own degradation, and it is self-healing: the failing Suspense
     * boundary is abandoned, the HTML carries the `loading` slot with a client-retry
     * marker, and the client re-runs the load on hydration. A transient hiccup fixes
     * itself; a real failure reaches the `error` slot one client-side attempt later.
     *
     * `'dehydrate'` trades that for a deterministic first paint. The server renders the
     * island's `error` slot into the HTML, carries the failure over in the payload, and the
     * client hydrates that cell straight to its error state — no re-run, no spinner. The
     * slot's `retry` is armed as always and re-runs the load on click.
     *
     * Two things to know before opting in. The failure's `message` is written into the
     * HTML, so a load whose errors carry backend text should say something else instead
     * (`cause` never travels — see the payload contract). And with an automatic
     * {@link MandalaConfig.retry} policy configured, the policy picks a dehydrated failure
     * up like any other: the island retries on the client instead of sitting on the error
     * slot the HTML shipped.
     *
     * Either way the server's own knowledge is unchanged: the failure is recorded, and the
     * response status derived from it, in both modes. And like the source-side `ssr`
     * marker, `'dehydrate'` needs the payload to reach the client: under a bare
     * `prerender` with no `HydrationProvider` — and on a client-only render — it does
     * nothing, because a first paint that hydration then contradicts is worse than the
     * default it replaces.
     */
    ssrErrors?: 'retry' | 'dehydrate';
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
     * Set when the mandala keeps its previous run across a re-resolve — `keepStale`, or
     * `loadingDelayMs` (which keeps it for the length of the window) — so the `Router` can
     * tell. It keys a route's element by a per-navigation counter, which remounts the
     * component on every navigation — and a remounted island has no previous run left to
     * keep. For these the Router keys by route name instead, so a param change on the same
     * route re-renders this instance (the mandala's own param-change path) rather than
     * replacing it. Absent otherwise, and the default keying is untouched.
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
 * The loading slot, reporting itself and honouring `loadingDelayMs`. A wrapper rather than a
 * call in the mandala's render because React is what decides to show a Suspense fallback —
 * by the time this renders, the mandala's own render has long since returned.
 *
 * Phase is `'loading'` either way: while the delay holds the slot back nothing is on screen,
 * which is what loading *is* — the option changes what the island shows, not what it is doing.
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
    // the server render *and* the hydration pass, so a slot that belongs in the HTML
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
    // Undefined means "no slot": the boundary rethrows to the nearest outer one, and a
    // server render has nothing deterministic to paint (see `ssrErrors`).
    const ErrorSlot = config.error as
        | ComponentType<{ inputs: unknown; error: SourceError; retry: () => void }>
        | undefined;
    const levels = flattenLevels(config.scope as Scope);
    // Build-time constants, so the element tree below keeps one stable shape per mandala.
    const ssrEnabled = config.ssr !== false;
    const keepStale = config.keepStale === true;
    const delayMs = config.loadingDelayMs ?? 0;
    const delayed = delayMs > 0;
    // Both options ride the same kept-run machinery (SI-03's): `keepStale` holds the
    // previous run for the whole re-resolution, a bare delay only until its deadline. With
    // neither, nothing is kept and the engine behaves exactly as it did before either landed.
    const keepsRun = keepStale || delayed;
    // `count: 0` is the absent option spelled out — no policy, no wrapper on the manual
    // retry, nothing to report.
    const retryOptions = config.retry && config.retry.count > 0 ? config.retry : null;
    const dehydrateErrors = config.ssrErrors === 'dehydrate';
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
        // Same gate, and for the same reason: a retry (manual or the policy's) and an
        // inputs change both mean "run the load", which is precisely what a dehydrated
        // failure is the alternative to.
        const errorsSlice = firstMount ? hydration.errors?.[mandalaId] : undefined;

        // Bound to this mandala's id; present only on the server (client has no `collect`),
        // where each Step records its resolved promise for the wire.
        const collect = hydration.collect
            ? (key: string, value: unknown, kind: 'value' | 'seed') =>
                  hydration.collect!(mandalaId, key, value, kind)
            : undefined;
        // The island's `ssrErrors` mode rides along: every failure is recorded for the
        // status derivation, and this is what decides whether it also crosses the wire.
        const collectError = hydration.collectError
            ? (key: string, error: SourceError) =>
                  hydration.collectError!(mandalaId, key, error, dehydrateErrors)
            : undefined;
        const claim = hydration.claim
            ? (key: string, section: 'data' | 'seeds' | 'errors') =>
                  hydration.claim!(mandalaId, key, section)
            : undefined;

        // Per-level data-cell caches, rebuilt when the inner tree remounts (treeKey
        // change). Held on the mandala's committed ref so a Step's `use()` suspension
        // can't discard a half-built cell (which would re-run its load forever).
        const cacheRef = useRef<{
            key: string;
            buckets: Bucket[];
            trace: DataTrace | undefined;
            recordedRejections: WeakSet<Promise<unknown>> | undefined;
            guardRejection: ((promise: Promise<unknown>) => Promise<unknown>) | undefined;
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
        // The `loadingDelayMs` gate, one per instance and only when the option is set — see
        // loadingDelay.ts. Null is the whole default path: no window, no timer, no
        // subscription that ever fires.
        const delayRef = useRef<LoadingDelay | null>(null);
        if (delayed) delayRef.current ??= new LoadingDelay(delayMs);
        const delay = delayRef.current;
        // The `retry` policy, same shape: one per instance, only when the option is set —
        // without it nothing below this line does anything at all.
        const policyRef = useRef<RetryPolicy | null>(null);
        if (retryOptions) policyRef.current ??= new RetryPolicy(retryOptions);
        const policy = policyRef.current;
        if (!cacheRef.current || cacheRef.current.key !== treeKey) {
            const previous = cacheRef.current;
            const committed = committedRef.current;
            // A resolution starts here — the generation being built *is* the resolution —
            // so this is where the delay's window opens (timer-less; see LoadingDelay).
            delay?.begin();
            if (previous) {
                // Only a run that reached the screen is worth keeping — and only if none
                // already is. A second re-resolve mid-stale-window discards the run that
                // never committed and keeps showing the original: swapping in a half-built
                // replacement would blank exactly what `keepStale` exists to preserve.
                if (
                    keepsRun &&
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
                // The rejection-proof twins this generation's Steps wait on under
                // `ssrErrors: 'dehydrate'` — scoped to the run for the same reason. Gated
                // on the collector, like the source-side `ssr` marker and for the same
                // reason: with nothing to carry the failure over, painting the error slot
                // would only mean the client paints something else a moment later. The
                // default degradation is what a render without a payload is *for*.
                guardRejection: collect && dehydrateErrors ? createRejectionGuard() : undefined,
            };
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

        // The retry a *human* asked for — the error slot's prop, `useScopeControls().retry`,
        // and `refresh()` with no key. It resets the automatic budget: a click is new
        // information, not a continuation of the streak the policy just gave up on. Held on
        // a ref so the error slot's `retry` prop keeps the stable identity `bumpRetry` had;
        // without the option it *is* `bumpRetry`, and nothing here is in the way.
        const manualRetryRef = useRef<(() => void) | null>(null);
        if (retryOptions) {
            manualRetryRef.current ??= () => {
                policyRef.current?.reset();
                bumpRetry();
            };
        }
        const manualRetry = manualRetryRef.current ?? bumpRetry;

        // The resolver's server-side error path, assembled where the pieces are: the run's
        // guard, plus the error slot the Step renders in place of the throw React would
        // hand to nobody. Present only on a collected server render of a `'dehydrate'`
        // island — `guardRejection` already carries both conditions.
        const guardRejection = cacheRef.current.guardRejection;
        const ssrErrors = guardRejection
            ? {
                  guard: guardRejection,
                  slot: ErrorSlot
                      ? (error: SourceError) => (
                            <ErrorSlot inputs={inputs} error={error} retry={manualRetry} />
                        )
                      : null,
              }
            : undefined;

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
        // The policy's verbs, wired the same way: its own retry is the *unwrapped* bump —
        // an automatic attempt continues the streak rather than restarting it.
        policy?.wire({ retry: bumpRetry, report: controller.reportRetrying });

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
                // ...and nothing left to delay or retry: the pending countdowns go with it.
                delayRef.current?.dispose();
                policyRef.current?.dispose();
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
            // Content is on screen, so the delay has nothing to hold back and the next
            // stretch without content gets the full deadline again...
            delay?.settled();
            // ...and whatever failure the retry policy was working through is over, however
            // many attempts it took: the budget is per failure streak, not per island.
            policy?.reset();
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

        // What the island shows while it has no fresh content: the loading slot, or — while
        // a stale window is open — the previous run standing in for it. `keepStale` keeps it
        // there for the whole re-resolution; a bare `loadingDelayMs` only until the deadline,
        // after which the slot takes over. Built here so all three sites that can show it
        // share one element, and re-renders at any one site reconcile against it. (The sites
        // are different fiber positions, so a move *between* them still remounts — see
        // internals.md §The kept run.)
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
            // and compared rather than reset, so the commit that *armed* an attempt can't
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
            controller: collect ? undefined : controller,
            collect,
            collectError,
            recordedRejections: cacheRef.current.recordedRejections,
            ssrErrors,
            claim,
            hydration: hydrationSlice,
            seeds: seedsSlice,
            errors: errorsSlice,
            trace: cacheRef.current.trace,
            // The leaf reports its commit only where something reads it: with none of the
            // three options there is no baseline to keep and no streak to end, and the
            // default path stays untouched.
            commit: keepsRun || retryOptions ? commitRun : undefined,
            swap: keepsRun ? swapRun : undefined,
            retainProvided: keepsRun ? retainProvided : undefined,
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
    const lazyComponent = config.component as {
        preload?: () => Promise<unknown>;
        moduleId?: string;
    };
    if (typeof lazyComponent.preload === 'function') Mandala.preload = lazyComponent.preload;
    if (lazyComponent.moduleId !== undefined) Mandala.moduleId = lazyComponent.moduleId;

    // Tell the Router not to remount this one on every navigation — a kept run cannot
    // survive its own island being replaced. See MandalaComponent.keepsRun.
    if (keepsRun) Mandala.keepsRun = true;

    // A readable identifier for this scope's read errors (best-effort: shared scopes keep
    // the last mandala's label).
    setScopeLabel(scopeKey, displayName);

    return Mandala;
}
